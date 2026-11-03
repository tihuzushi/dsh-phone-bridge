// dsh-phone-bridge — host half.
//
// Runs *inside* the DeepSeek Harness host process as a cordis plugin, so the
// phone bridge no longer needs a second Node process, a separate startup script
// or a port scan: the host web server already knows which loopback port it is
// serving on.
//
// What it does:
//   1. listens on 0.0.0.0:8765 (configurable) for phones on the LAN / tailnet
//   2. pairs a phone with a 6-digit code and sets the dsh_phone cookie
//   3. proxies HTTP + WebSocket upgrades to the host's own loopback web server,
//      attaching a locally minted DSH browser-session cookie
//   4. injects the transport-level <head> plumbing the phone WebView needs
//      (viewport-fit, polyfills, locale/font bootstrap). The mobile UI itself
//      ships as this package's client half.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile, execFileSync } from 'node:child_process'

export const name = 'dsh-phone-bridge'
// No service injection: the bridge only needs the host's own listen port, which it
// resolves lazily (webServer service when available, netstat by pid otherwise).
// Waiting on a service here would silently park the plugin if the name ever differs.
export const inject = []

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CREDENTIALS = path.join(DSH_HOME, '.credentials.yaml')
const STATE_PATH = path.join(DSH_HOME, 'phone-bridge.json')
const STATUS_PATH = path.join(DSH_HOME, 'phone-bridge-status.json')
const BUILD_FILE = new URL('./build.json', import.meta.url)
// The package root: lib/index.js -> <pkg>. A hot update rewrites files in here.
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const REPO_SLUG = 'tihuzushi/dsh-phone-bridge'
const REPO_BRANCH = 'main'
const REPO_URL = `https://github.com/${REPO_SLUG}`
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_SLUG}`
const API_BASE = `https://api.github.com/repos/${REPO_SLUG}`
// Everything a hot update needs; kept explicit so nothing else in the repo can
// land in the installed copy.
const UPDATE_FILES = ['package.json', 'lib/index.js', 'lib/client.js', 'lib/build.json', 'cordis.patch.yml', 'README.md', 'LICENSE']

// A wrong code must not lock anyone out; it only stretches the retry interval so
// the phone's auto-retry loop cannot hammer /pair. The whole thing can be turned
// off from the desktop settings page (state.throttle).
const PAIR_MIN_INTERVAL_MS = 1500
const PAIR_MAX_INTERVAL_MS = 15000
const PAIR_IDLE_RESET_MS = 60 * 1000

function compareVersions(left, right) {
  const a = String(left || '0').split('.').map((part) => parseInt(part, 10) || 0)
  const b = String(right || '0').split('.').map((part) => parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0)
    if (delta) return delta
  }
  return 0
}

function localBuild() {
  try {
    const raw = fs.readFileSync(BUILD_FILE, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(raw)
    return { version: String(parsed.version || '0.0.0'), build: String(parsed.build || 'unknown') }
  } catch {
    return { version: '0.0.0', build: 'unknown' }
  }
}

// raw.githubusercontent.com is CDN-cached: right after a push, package.json and
// lib/build.json can come back from different commits. Fetching every file at the
// same commit sha makes that impossible, because those URLs are immutable.
async function resolveRef() {
  try {
    const res = await fetch(`${API_BASE}/commits/${REPO_BRANCH}`, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-phone-bridge-updater' },
    })
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`)
    const json = await res.json()
    const sha = String((json && json.sha) || '')
    if (/^[0-9a-f]{7,40}$/i.test(sha)) return sha
    throw new Error('读不到仓库 HEAD')
  } catch {
    // Still usable, just exposed to the CDN lag.
    return REPO_BRANCH
  }
}

async function fetchRawFile(ref, name) {
  const res = await fetch(`${RAW_BASE}/${ref}/${name}`, {
    signal: AbortSignal.timeout(15000),
    headers: { 'user-agent': 'dsh-phone-bridge-updater' },
  })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return await res.text()
}

async function fetchRemotePackage(ref) {
  const pkg = JSON.parse(await fetchRawFile(ref, 'package.json'))
  if (pkg.name !== 'dsh-phone-bridge') throw new Error('远程 package.json 不属于这个插件')
  return pkg
}

function randomCode() {
  return String(crypto.randomInt(100000, 1000000))
}

function loadState() {
  const defaults = { port: 8765, host: '0.0.0.0', pairingCode: randomCode() }
  try {
    if (!fs.existsSync(STATE_PATH)) {
      fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
      fs.writeFileSync(STATE_PATH, JSON.stringify(defaults, null, 2) + '\n', 'utf8')
      return defaults
    }
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    return {
      port: Number(saved.port) || defaults.port,
      host: saved.host || defaults.host,
      pairingCode: /^\d{6}$/.test(String(saved.pairingCode || '')) ? String(saved.pairingCode) : defaults.pairingCode,
    }
  } catch {
    return defaults
  }
}

function readSecret() {
  const text = fs.readFileSync(CREDENTIALS, 'utf8')
  const match = text.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/)
  if (!match) throw new Error('credentials file has no browser-session secret yet; open the DSH web UI once')
  return Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
}

function mintDshCookie(secret, origin) {
  const authority = new URL(origin).host
  const cookieName = 'dsh-auth-' + crypto.createHash('sha256').update(authority).digest('base64url')
  const now = Date.now()
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 30 * 24 * 60 * 60 * 1000 }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${cookieName}=v1.${body}.${signature}`
}

function phoneCookie(code) {
  return crypto.createHmac('sha256', code).update('dsh-phone-v1').digest('base64url')
}

function parseCookies(header = '') {
  const out = {}
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at < 0) continue
    out[segment.slice(0, at).trim()] = segment.slice(at + 1).trim()
  }
  return out
}

function interfaces() {
  const lan = []
  const tailscale = []
  for (const [ifName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (/tailscale/i.test(ifName) && /^100\./.test(entry.address)) tailscale.push(entry.address)
      else if (!/^100\./.test(entry.address) || !/tailscale/i.test(ifName)) lan.push({ ifName, address: entry.address })
    }
  }
  return { lan, tailscale }
}

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download/windows'

// The CLI is not always on PATH; the installer's default location is enough to
// tell "not installed" apart from "installed but not connected".
const TAILSCALE_CLI = [
  process.env.TAILSCALE_EXE,
  'tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
].filter(Boolean)

function runTailscale(args, timeout = 2500) {
  return new Promise((resolve) => {
    const candidates = [...TAILSCALE_CLI]
    const attempt = () => {
      const exe = candidates.shift()
      if (!exe) return resolve(null)
      execFile(exe, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (error && !stdout) return attempt()
        resolve(String(stdout || ''))
      })
    }
    attempt()
  })
}

async function detectTailscale() {
  const info = {
    installed: false,
    running: false,
    state: 'not-installed',
    ip: '',
    hostname: '',
    version: '',
    downloadUrl: TAILSCALE_DOWNLOAD_URL,
    checkedAt: Date.now(),
  }

  const versionText = await runTailscale(['version'])
  if (versionText) {
    info.installed = true
    info.version = (versionText.split(/\r?\n/)[0] || '').trim()
  }

  const statusText = await runTailscale(['status', '--json'], 3500)
  let status = null
  if (statusText) {
    try { status = JSON.parse(statusText.slice(statusText.indexOf('{'))) } catch { status = null }
  }

  if (status) {
    info.installed = true
    info.version = info.version || String(status.Version || '')
    info.hostname = String(status.Self?.HostName || '').trim()
    const ips = Array.isArray(status.Self?.TailscaleIPs) ? status.Self.TailscaleIPs : []
    info.ip = ips.find((ip) => /^100\./.test(String(ip))) || ''
    // Deliberately no account/login name: it is a phone number or mailbox and
    // this page ends up in screenshots.
    const backend = String(status.BackendState || '')
    info.running = backend === 'Running' && !!info.ip
    info.state = info.running ? 'running' : (backend === 'NeedsLogin' ? 'needs-login' : 'stopped')
  } else {
    // No usable CLI: fall back to the interface Tailscale creates (100.64.0.0/10).
    const { tailscale } = interfaces()
    if (tailscale.length) {
      info.installed = true
      info.running = true
      info.state = 'running'
      info.ip = tailscale[0]
    }
  }

  if (!info.ip) {
    const { tailscale } = interfaces()
    if (tailscale.length) info.ip = tailscale[0]
  }
  if (!info.installed && fs.existsSync('C:\\Program Files\\Tailscale\\Tailscale.exe')) info.installed = true
  return info
}

function loopbackPortsOfPid(pid) {
  try {
    const text = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 8 * 1024 * 1024 })
    const ports = new Set()
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
      if (match && Number(match[2]) === pid) ports.add(Number(match[1]))
    }
    return [...ports]
  } catch {
    return []
  }
}

async function looksLikeDsh(origin) {
  try {
    const response = await fetch(origin + '/', {
      redirect: 'manual',
      signal: AbortSignal.timeout(700),
      headers: { 'user-agent': 'dsh-phone-bridge/2.0 (upstream-detect)' },
    })
    const body = await response.text()
    if (response.status === 401) return /dsh web authentication required/i.test(body)
    if (response.status === 200) return body.includes('__DSH_BOOT__') || body.includes('DeepSeek Harness')
    return false
  } catch {
    return false
  }
}

// The desktop app is not served from http://127.0.0.1:<port>: its window runs on
// its own dsh-app://app origin. A fetch from there to the bridge is a normal CORS
// request carrying Origin: dsh-app://app, which a loopback-only allow list refuses
// — that is why the settings section sat on “not running”.
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const APP_SCHEME_ORIGIN = /^(dsh-app|dsh|app|file|chrome-extension|moz-extension|ms-browser-extension):\/\//i

function isLocalBrowserOrigin(originHeader) {
  return !originHeader || originHeader === 'null' || LOOPBACK_ORIGIN.test(originHeader) || APP_SCHEME_ORIGIN.test(originHeader)
}

// JSONP finds no CORS at all, so it also works where a preflight is refused.
function jsonpCallback(raw) {
  const name = String(raw || '').replace(/[^A-Za-z0-9_$.]/g, '').slice(0, 64)
  return name && !/^\d/.test(name) ? name : ''
}

function corsHeadersFor(req, options = {}) {
  const originHeader = req.headers.origin || ''
  if (options.permissive !== true && !isLocalBrowserOrigin(originHeader)) return { vary: 'origin' }
  return {
    'access-control-allow-origin': originHeader && originHeader !== 'null' ? originHeader : '*',
    'access-control-allow-methods': options.methods || 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

const POLYFILL = '<script id="dsh-phone-polyfill">(function(){if(typeof Promise.withResolvers!=="function"){Promise.withResolvers=function(){var resolve,reject;var promise=new Promise(function(res,rej){resolve=res;reject=rej});return {promise:promise,resolve:resolve,reject:reject}}}if(!Array.prototype.toSorted){Array.prototype.toSorted=function(cmp){return this.slice().sort(cmp)}}if(!Array.prototype.toReversed){Array.prototype.toReversed=function(){return this.slice().reverse()}}if(!Array.prototype.with){Array.prototype.with=function(index,value){var copy=this.slice();copy[index]=value;return copy}}if(typeof AbortSignal.any!=="function"){AbortSignal.any=function(signals){var controller=new AbortController();var list=Array.from(signals);function abort(){controller.abort(this.reason)}for(var i=0;i<list.length;i++){var signal=list[i];if(signal.aborted){controller.abort(signal.reason);return controller.signal}signal.addEventListener("abort",abort,{once:true})}return controller.signal}}})()</script>'

const LOCALE_BOOTSTRAP = '<script id="hp-locale-bootstrap">(function(){try{var k="hp-locale";var v=localStorage.getItem(k);if(v!=="zh"&&v!=="en")v="zh";try{if(window.HarnessNative&&window.HarnessNative.getUiLanguage){var nv=window.HarnessNative.getUiLanguage();if(nv==="zh"||nv==="en")v=nv;}}catch(e){}window.__DSH_LOCALE__={read:function(){return Promise.resolve({languages:["zh-CN","en-US"],preference:v})},onChange:function(active){if(active==="zh"||active==="en"){localStorage.setItem(k,active);document.documentElement.lang=active==="zh"?"zh-CN":"en";try{if(window.HarnessNative&&window.HarnessNative.setUiLanguage)window.HarnessNative.setUiLanguage(active);}catch(e){}try{document.dispatchEvent(new CustomEvent("hp-locale-change",{detail:active}));}catch(e){}}}};}catch(e){}})()</script>'

const FONT_BOOTSTRAP = '<script id="hp-font-bootstrap">(function(){try{var s=localStorage.getItem("hp_font_size")||"14";var n=parseInt(s,10);if(!(n>=10&&n<=28))n=14;document.documentElement.style.setProperty("--hp-font-size",n+"px");}catch(e){}})()</script>'
  + '<style id="hp-local-font">html.hp-mobile body{--dsh-content-font-size:var(--hp-font-size,14px)!important}</style>'

function injectHead(html) {
  if (html.includes('id="dsh-phone-polyfill"')) return html
  const head = [
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" content="#151517">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    LOCALE_BOOTSTRAP,
    FONT_BOOTSTRAP,
    POLYFILL,
  ].join('')
  return html.replace(/<head([^>]*)>/i, `<head$1>${head}`)
}

function fileType(name) {
  const ext = path.extname(name).slice(1).toLowerCase()
  const types = {
    pdf: 'application/pdf', zip: 'application/zip', apk: 'application/vnd.android.package-archive',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json',
    csv: 'text/csv; charset=utf-8', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
  }
  return types[ext] || 'application/octet-stream'
}

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#151517;color:#ececf1;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:min(460px,calc(100vw - 40px));padding:28px;border:1px solid #2d2d33;border-radius:20px;background:#1c1c20;box-shadow:0 16px 48px #0008}
.logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#4d6bfe,#7d3cff);font-weight:700;margin-bottom:16px}
h1{font-size:20px;margin:0 0 8px}p{color:#9b9ba6;margin:0 0 12px;word-break:break-all}
code{color:#c9d3ff;background:#26262c;padding:2px 7px;border-radius:6px}
a{color:#8fb0ff}
</style><div class="card"><div class="logo">D</div><h1>${title}</h1>${body}</div></html>`
}

export function apply(ctx, pluginConfig = {}) {
  const log = (...args) => {
    try { console.log('[dsh-phone-bridge]', ...args) } catch {}
    try { ctx.logger?.('dsh-phone-bridge')?.info?.(args.join(' ')) } catch {}
  }

  const state = { ...loadState(), ...pluginConfig }
  if (state.autoPort === undefined) state.autoPort = true
  if (state.throttle === undefined) state.throttle = true
  let expectedPhoneCookie = phoneCookie(state.pairingCode)
  let preferredPort = Number(state.port) || 8765
  let activePort = preferredPort
  let portTries = 0
  const listenHost = state.host || '0.0.0.0'

  function saveState() {
    try {
      fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
      fs.writeFileSync(STATE_PATH, JSON.stringify({
        port: preferredPort,
        autoPort: state.autoPort !== false,
        throttle: state.throttle !== false,
        host: listenHost,
        pairingCode: state.pairingCode,
        runtimePort: activePort,
      }, null, 2) + "\n", "utf8");
    } catch {}
  }

  let secret
  try {
    secret = readSecret()
  } catch (error) {
    log('无法读取 DSH 凭据，桥接未启动：' + error.message)
    return
  }

  let origin = ''
  let upstream = null
  let dshCookie = ''
  let upstreamOrigin = ''
  const pairFailures = new Map()

  function setOrigin(next) {
    origin = next
    upstream = new URL(next)
    upstreamOrigin = upstream.origin
    dshCookie = mintDshCookie(secret, next)
  }

  let tailscale = { installed: false, running: false, state: 'checking', ip: '', hostname: '', version: '', downloadUrl: TAILSCALE_DOWNLOAD_URL, checkedAt: 0 }
  let tailscaleBusy = false

  async function refreshTailscale() {
    if (tailscaleBusy) return tailscale
    tailscaleBusy = true
    try {
      tailscale = await detectTailscale()
    } catch (error) {
      log('检测 Tailscale 失败：' + (error && error.message))
    } finally {
      tailscaleBusy = false
    }
    return tailscale
  }

  function tailscaleSnapshot() {
    return { ...tailscale, url: tailscale.ip ? `http://${tailscale.ip}:${activePort}` : '', downloadUrl: TAILSCALE_DOWNLOAD_URL }
  }

  function hostPort() {
    try {
      const web = ctx.get?.('webServer') ?? ctx.webServer
      const port = web && typeof web.port === 'number' ? web.port : 0
      if (port > 0) return port
    } catch {}
    return 0
  }

  async function resolveUpstream() {
    const port = hostPort()
    if (port > 0) {
      const candidate = `http://127.0.0.1:${port}`
      if (await looksLikeDsh(candidate)) return candidate
      return candidate
    }
    for (const candidatePort of loopbackPortsOfPid(process.pid)) {
      const candidate = `http://127.0.0.1:${candidatePort}`
      if (await looksLikeDsh(candidate)) return candidate
    }
    return ''
  }

  function safeEqual(left, right) {
    const a = Buffer.from(String(left))
    const b = Buffer.from(String(right))
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  // No lockout: a wrong code only slows the retries down. The phone reloads the
  // pair URL in a loop when it holds a stale code, so the goal is to damp that
  // loop, not to lock a human out for minutes.
  function pairThrottle(ip) {
    if (state.throttle === false) return 0
    const record = pairFailures.get(ip)
    if (!record) return 0
    const now = Date.now()
    if (now - record.lastAttemptAt > PAIR_IDLE_RESET_MS) {
      pairFailures.delete(ip)
      return 0
    }
    const interval = Math.min(PAIR_MIN_INTERVAL_MS * 2 ** Math.min(record.streak, 8), PAIR_MAX_INTERVAL_MS)
    const wait = record.lastAttemptAt + interval - now
    return wait > 0 ? wait : 0
  }

  function notePairAttempt(ip, ok) {
    const now = Date.now()
    if (ok) {
      pairFailures.delete(ip)
      return 0
    }
    const record = pairFailures.get(ip)
    if (!record || now - record.lastAttemptAt > PAIR_IDLE_RESET_MS) pairFailures.set(ip, { lastAttemptAt: now, streak: 1 })
    else {
      record.lastAttemptAt = now
      record.streak += 1
    }
    return pairFailures.get(ip).streak
  }

  // A rotated code means whoever was failing was probably just using the old one,
  // so the throttle state goes away with it.
  function clearPairFailures() {
    const cleared = pairFailures.size
    pairFailures.clear()
    return cleared
  }

  function clientIp(req) {
    return req.socket.remoteAddress || 'unknown'
  }

  function isLoopbackClient(req) {
    const ip = clientIp(req).replace(/^::ffff:/, '')
    return ip === '127.0.0.1' || ip === '::1'
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 320 * 1024 * 1024) {
          reject(new Error('request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }

  function forwardHeaders(req, body) {
    const headers = { ...req.headers }
    headers.host = upstream.host
    headers.cookie = dshCookie
    headers['accept-encoding'] = 'identity'
    delete headers.connection
    delete headers['proxy-connection']
    delete headers['keep-alive']
    delete headers.upgrade
    delete headers['transfer-encoding']
    delete headers['content-length']
    if (body) headers['content-length'] = String(body.length)
    if (headers.origin) headers.origin = upstreamOrigin
    if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, upstreamOrigin)
    return headers
  }

  function forwardHttp(req, res, body, isIndexRequest) {
    const headers = forwardHeaders(req, body)
    const upstreamReq = http.request({
      hostname: upstream.hostname,
      port: upstream.port || 80,
      method: req.method,
      path: req.url,
      headers,
    }, (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers }
      delete responseHeaders['set-cookie']
      if (req.headers.origin) responseHeaders['access-control-allow-origin'] = req.headers.origin
      if (responseHeaders.location) responseHeaders.location = responseHeaders.location.replaceAll(upstreamOrigin, '')

      const type = String(responseHeaders['content-type'] || '')
      if (!(isIndexRequest && type.includes('text/html'))) {
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders)
        upstreamRes.pipe(res)
        return
      }
      const chunks = []
      upstreamRes.on('data', (chunk) => chunks.push(chunk))
      upstreamRes.on('end', () => {
        const text = injectHead(Buffer.concat(chunks).toString('utf8'))
        delete responseHeaders['content-length']
        delete responseHeaders['transfer-encoding']
        delete responseHeaders['content-encoding']
        responseHeaders['content-length'] = String(Buffer.byteLength(text))
        responseHeaders['cache-control'] = 'no-store'
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders)
        res.end(text)
      })
    })
    upstreamReq.on('error', (error) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`HARNESS 无法连接：${error.message}\n`)
      } else {
        res.destroy(error)
      }
    })
    if (body) upstreamReq.end(body)
    else upstreamReq.end()
  }

  function clientRev() {
    try { return JSON.parse(fs.readFileSync(BUILD_FILE, 'utf8')).build || null } catch { return null }
  }

  let updateBusy = false

  async function remoteRelease() {
    const ref = await resolveRef()
    const pkg = await fetchRemotePackage(ref)
    return { ref, version: String(pkg.version || '') }
  }

  // Downloads the published files and swaps them into the installed copy. The
  // running process keeps its already-loaded code, so the caller has to restart.
  async function installUpdate() {
    if (updateBusy) throw new Error('已经有一次更新在进行')
    updateBusy = true
    try {
      const from = localBuild()
      const { ref, version: to } = await remoteRelease()
      if (!to) throw new Error('远程版本号为空')
      if (compareVersions(to, from.version) <= 0) return { updated: false, from: from.version, to, ref }

      const files = new Map()
      for (const name of UPDATE_FILES) files.set(name, await fetchRawFile(ref, name))
      const pkg = JSON.parse(files.get('package.json'))
      if (pkg.name !== 'dsh-phone-bridge' || pkg.version !== to) throw new Error('下载内容校验失败')
      if (!files.get('lib/index.js').includes('export function apply')) throw new Error('lib/index.js 内容异常')
      if (!files.get('lib/client.js').includes('__ModuleLoader__')) throw new Error('lib/client.js 内容异常')

      const backup = path.join(os.tmpdir(), `dsh-phone-bridge-${from.version}-${Date.now()}`)
      const written = []
      try {
        for (const [name, text] of files) {
          const target = path.join(PKG_ROOT, name)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          if (fs.existsSync(target)) {
            const copy = path.join(backup, name)
            fs.mkdirSync(path.dirname(copy), { recursive: true })
            fs.copyFileSync(target, copy)
          }
          const tmp = `${target}.hp-tmp`
          fs.writeFileSync(tmp, text, 'utf8')
          fs.renameSync(tmp, target)
          written.push(name)
        }
      } catch (error) {
        for (const name of written) {
          try { fs.copyFileSync(path.join(backup, name), path.join(PKG_ROOT, name)) } catch {}
        }
        throw error
      }
      log(`已热更新 ${from.version} → ${to}，重启 DSH 生效（备份：${backup}）`)
      return { updated: true, from: from.version, to, backup, files: written.length }
    } finally {
      updateBusy = false
    }
  }

  function statusPayload() {
    const build = localBuild()
    return {
      ok: true,
      listening: server.listening === true,
      host: listenHost,
      port: activePort,
      preferredPort,
      autoPort: state.autoPort !== false,
      pairingCode: state.pairingCode,
      throttle: state.throttle !== false,
      upstream: origin || null,
      // Only Tailscale is advertised: the phone app carries its own tailnet node.
      tailscale: tailscaleSnapshot(),
      version: build.version,
      build: build.build,
      repoUrl: REPO_URL,
      clientRev: clientRev(),
      pairUrl: `http://127.0.0.1:${activePort}/_dsh-phone`,
      pid: process.pid,
    }
  }

  function statusPage(req, res) {
    if (!isLoopbackClient(req)) {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page('请在电脑上打开', '<p>配对信息只在本机回环地址上显示。</p>'))
      return
    }
    const ts = tailscaleSnapshot()
    let tail
    if (ts.running) {
      // The app finds this machine through the tailnet, so only its name matters.
      tail = `<p>这台电脑：<code>${ts.hostname || ts.ip}</code></p>`
    } else if (ts.installed) {
      tail = '<p>Tailscale 已安装，但还没有连接。请在电脑上打开 Tailscale 并登录。</p>'
    } else {
      tail = `<p>这台电脑没有检测到 Tailscale。<a href="${TAILSCALE_DOWNLOAD_URL}" target="_blank" rel="noreferrer noopener">下载安装 Tailscale</a> 并登录后刷新本页。</p>`
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(page('手机配对', `
      <p>配对码：<code>${state.pairingCode}</code></p>
      ${tail}
      <p>手机 App 里登录同一个 Tailscale 账号，选中这台电脑，再填上面的配对码。</p>`))
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!upstream) {
        const resolved = await resolveUpstream()
        if (resolved) setOrigin(resolved)
      }
      const url = new URL(req.url || '/', 'http://bridge.local')
      const cookies = parseCookies(req.headers.cookie)

      if (url.pathname === '/__bridge/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, upstream: origin, paired: cookies.dsh_phone === expectedPhoneCookie }))
        return
      }

      if (url.pathname === '/_dsh-phone') {
        statusPage(req, res)
        return
      }

      if (url.pathname === '/__dsh-phone/config') {
        if (!isLoopbackClient(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'loopback only' }))
          return
        }
        const corsHeaders = corsHeadersFor(req, { methods: 'POST, OPTIONS' })
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders)
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'POST only' }))
          return
        }
        let patch = {}
        try { patch = JSON.parse((await readBody(req)).toString('utf8') || '{}') } catch { patch = {} }
        let rebindNeeded = false
        if (patch.port !== undefined) {
          const next = Number(patch.port)
          if (Number.isInteger(next) && next >= 1024 && next <= 65535 && next !== preferredPort) {
            state.port = next
            rebindNeeded = true
          }
        }
        if (patch.autoPort !== undefined) state.autoPort = patch.autoPort !== false
        if (typeof patch.pairingCode === 'string' && /^\d{6}$/.test(patch.pairingCode) && patch.pairingCode !== state.pairingCode) {
          state.pairingCode = patch.pairingCode
          expectedPhoneCookie = phoneCookie(state.pairingCode)
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          ...corsHeaders,
        })
        res.end(JSON.stringify({ ok: true, restartNeeded: rebindNeeded }))
        if (rebindNeeded) setTimeout(() => rebind(state.port), 150)
        return
      }

      if (url.pathname === '/__dsh-phone/status' || url.pathname === '/__dsh-phone/status.js') {
        if (!isLoopbackClient(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'loopback only' }))
          return
        }
        // Public pairing information: readable from every origin the app itself
        // runs on (dsh-app://, file://, 127.0.0.1) and from the phone page.
        const corsHeaders = corsHeadersFor(req, { permissive: true })
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders)
          res.end()
          return
        }
        const payload = JSON.stringify(statusPayload()).replace(/</g, '\\u003c')
        // JSONP: a <script> tag has no CORS, so this also works in the desktop
        // window, whose origin is dsh-app://app rather than the loopback server.
        if (url.pathname === '/__dsh-phone/status.js') {
          const callback = jsonpCallback(url.searchParams.get('cb'))
          res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders })
          res.end(callback ? callback + '(' + payload + ');' : 'void 0;')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders })
        res.end(payload)
        return
      }

      if (url.pathname === '/__dsh-phone/update') {
        if (!isLoopbackClient(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'loopback only' }))
          return
        }
        const corsHeaders = corsHeadersFor(req, { methods: 'GET, POST, OPTIONS' })
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders)
          res.end()
          return
        }
        const local = localBuild()
        const send = (body) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders })
          res.end(JSON.stringify(body))
        }
        if (req.method === 'GET') {
          try {
            const { ref, version: latest } = await remoteRelease()
            send({ ok: true, current: local.version, build: local.build, latest, ref: ref.slice(0, 7), hasUpdate: compareVersions(latest, local.version) > 0, repoUrl: REPO_URL })
          } catch (error) {
            send({ ok: false, current: local.version, build: local.build, repoUrl: REPO_URL, error: String((error && error.message) || error) })
          }
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'GET or POST only' }))
          return
        }
        try {
          const result = await installUpdate()
          send({ ok: true, ...result, repoUrl: REPO_URL, restartNeeded: result.updated === true })
        } catch (error) {
          send({ ok: false, current: local.version, error: String((error && error.message) || error) })
        }
        return
      }

      if (url.pathname === '/pair') {
        const ip = clientIp(req)
        // A right code always wins, even mid-throttle: only wrong guesses wait.
        if (safeEqual(url.searchParams.get('code') || '', state.pairingCode)) {
          notePairAttempt(ip, true)
          // One phone UI only: there is no 1.x client left to keep a second one for.
          const pairCookies = [`dsh_phone=${expectedPhoneCookie}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`]
          res.writeHead(302, { 'cache-control': 'no-store', location: './', 'set-cookie': pairCookies })
          res.end()
          return
        }
        const wait = pairThrottle(ip)
        if (wait > 0) {
          // Wrong code on the phone -> its WebView reloads /pair in a loop. Answer
          // with a readable page and a short Retry-After instead of a lockout.
          const seconds = Math.max(1, Math.ceil(wait / 1000))
          res.writeHead(429, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': String(seconds) })
          res.end(page('配对请求太快', `
            <p>配对码不对时会限制重试频率，${seconds} 秒后自动恢复。</p>
            <p>在电脑上查看当前配对码：<code>http://127.0.0.1:${activePort}/_dsh-phone</code>，或 DSH 设置 → DSH Phone Assistant。</p>
            <p>也可以在设置页点「重新生成配对码」，或关掉「配对重试节流」。</p>`))
          return
        }
        const strike = notePairAttempt(ip, false)
        log(`配对码不匹配：${ip}（连续第 ${strike} 次）`)
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(page('配对码不正确', `
          <p>手机上的配对码和电脑当前的不一致，重新输入电脑上显示的那 6 位数字即可。</p>
          <p>电脑上查看：<code>http://127.0.0.1:${activePort}/_dsh-phone</code>，或 DSH 设置 → DSH Phone Assistant。</p>
          <p>输错只会让重试间隔变长，正确的码随时能通过。</p>`))
        return
      }

      // Rotate the code from the desktop (settings page), which also lifts a
      // lockout, so a stale code on the phone cannot lock anyone out for 10 minutes.
      if (url.pathname === '/__dsh-phone/pairing') {
        if (!isLoopbackClient(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'loopback only' }))
          return
        }
        const corsHeaders = corsHeadersFor(req, { methods: 'GET, POST, OPTIONS' })
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders)
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'POST only' }))
          return
        }
        let patch = {}
        try { patch = JSON.parse((await readBody(req)).toString('utf8') || '{}') } catch { patch = {} }
        const requested = String(patch.code || '')
        if (requested && !/^\d{6}$/.test(requested)) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: '配对码必须是 6 位数字' }))
          return
        }
        // { throttle: false } turns the retry damping off entirely.
        if (patch.throttle !== undefined) state.throttle = patch.throttle !== false
        if (requested) state.pairingCode = requested
        else if (patch.rotate !== false) state.pairingCode = randomCode()
        expectedPhoneCookie = phoneCookie(state.pairingCode)
        const cleared = clearPairFailures()
        saveState()
        log(`配对码 ${state.pairingCode}，重试节流${state.throttle === false ? '已关闭' : '开启'}，清除 ${cleared} 条记录`)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders })
        res.end(JSON.stringify({
          ok: true,
          pairingCode: state.pairingCode,
          throttle: state.throttle !== false,
          pairUrl: `http://127.0.0.1:${activePort}/_dsh-phone`,
          cleared,
        }))
        return
      }

      if (cookies.dsh_phone !== expectedPhoneCookie) {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
        res.end(page('需要先配对', `<p>这个地址只接受已配对的 HARNESS 手机客户端。</p>
          <p>在电脑上打开 <code>http://127.0.0.1:${activePort}/_dsh-phone</code> 查看配对码与地址。</p>`))
        return
      }

      if (url.pathname === '/__bridge/file') {
        const requested = url.searchParams.get('path') || ''
        const name = url.searchParams.get('name') || path.basename(requested)
        try {
          const resolved = path.isAbsolute(requested) ? requested : path.resolve(requested)
          const stat = fs.statSync(resolved)
          if (!stat.isFile()) throw new Error('not a file')
          if (stat.size > 512 * 1024 * 1024) throw new Error('file too large')
          res.writeHead(200, {
            'content-type': fileType(name),
            'content-length': String(stat.size),
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          })
          fs.createReadStream(resolved).pipe(res)
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('file not found')
        }
        return
      }

      const body = await readBody(req)
      if (!upstream) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('还没有识别到 HARNESS 的 Web GUI 端口，稍后重试。\n')
        return
      }
      forwardHttp(req, res, body, url.pathname === '/' || url.pathname === '/index.html')
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(String(error.stack || error))
      } else {
        res.destroy(error)
      }
    }
  })

  server.on('upgrade', (req, socket, head) => {
    const cookies = parseCookies(req.headers.cookie)
    if (cookies.dsh_phone !== expectedPhoneCookie) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    const target = net.connect(Number(upstream.port) || 80, upstream.hostname, () => {
      const headers = { ...req.headers }
      headers.host = upstream.host
      headers.cookie = dshCookie
      headers.origin = upstreamOrigin
      if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, upstreamOrigin)
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) value.forEach((item) => lines.push(`${key}: ${item}`))
        else if (value !== undefined) lines.push(`${key}: ${value}`)
      }
      target.write(lines.join('\r\n') + '\r\n\r\n')
      if (head && head.length) target.write(head)
      socket.pipe(target).pipe(socket)
      target.on('error', () => socket.destroy())
      socket.on('error', () => target.destroy())
      socket.on('close', () => target.destroy())
    })
    target.on('error', () => {
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    })
  })

  function writeStatus(extra) {
    try {
      fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true })
      fs.writeFileSync(STATUS_PATH, JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        listen: `${listenHost}:${activePort}`,
        upstream: origin || null,
        pairingCode: state.pairingCode,
        ...extra,
      }, null, 2) + '\n', 'utf8')
    } catch {}
  }

  let listenAttempts = 0

  function startListening() {
    listenAttempts += 1
    writeStatus({ stage: 'listening', attempts: listenAttempts })
    server.listen(activePort, listenHost, () => {
      writeStatus({ stage: 'listening-ok', attempts: listenAttempts })
      saveState()
      log(`已监听 ${listenHost}:${activePort}`)
      const ts = tailscaleSnapshot()
      if (ts.running && ts.url) log(`Tailscale: ${ts.url}/pair?code=${state.pairingCode}`)
      else log('Tailscale 尚未连接，手机暂时连不回来（设置页里可以看到原因）')
      log(`本机配对页：http://127.0.0.1:${activePort}/_dsh-phone  配对码：${state.pairingCode}`)
    })
  }

  // Move the listener to another port without restarting HARNESS.
  function rebind(nextPort) {
    const target = Number(nextPort) || preferredPort
    preferredPort = target
    activePort = target
    portTries = 0
    try {
      server.close(() => startListening())
      if (typeof server.closeAllConnections === 'function') setTimeout(() => { try { server.closeAllConnections() } catch {} }, 50)
    } catch {
      startListening()
    }
  }

  // Hand the status to the browser without a cross-origin fetch: DSH renders the
  // index HTML per request, so a tap can inline it as window.__HP_STATUS__.
  try {
    const web = ctx.get?.('webServer') ?? ctx.webServer
    if (web && typeof web.tapIndex === 'function') {
      web.tapIndex((html) => {
        try {
          const payload = JSON.stringify(statusPayload()).replace(/</g, '\\u003c')
          const tag = '<script id="hp-phone-status">window.__HP_STATUS__=' + payload + ';</script>'
          return html.includes('hp-phone-status') ? html : html.replace(/<head([^>]*)>/i, '<head$1>' + tag)
        } catch (e) {
          return html
        }
      })
      log('已注册页面状态注入（window.__HP_STATUS__）')
    } else {
      log('webServer.tapIndex 不可用，继续使用直连状态接口')
    }
  } catch (e) {
    log('注册页面状态注入失败：' + (e && e.message))
  }

  server.on('error', (error) => {
    writeStatus({ stage: 'listen-error', attempts: listenAttempts, port: activePort, error: `${error.code || ''} ${error.message}` })
    log(`监听 ${listenHost}:${activePort} 失败：${error.message}`)
    if (error.code === 'EADDRINUSE') {
      if (state.autoPort !== false && portTries < 30) {
        portTries += 1
        activePort = activePort >= 65535 ? preferredPort : activePort + 1
        log(`端口被占用，自动改用 ${activePort}（可在设置里改回固定端口）`)
        setTimeout(startListening, 250)
        return
      }
      log(`端口 ${activePort} 被占用且自动切换已关闭，修改 ${STATE_PATH} 里的 port 或打开设置里的 DSH Phone Assistant 换一个端口。`)
    }
  })

  const tailscaleTimer = setInterval(() => { refreshTailscale() }, 20000)

  ;(async () => {
    const resolved = await resolveUpstream()
    if (resolved) {
      setOrigin(resolved)
      log(`上游：${resolved}`)
    } else {
      log('没有识别到本机 Web GUI 端口，桥接会在首次请求时重试')
    }
    refreshTailscale().then((ts) => {
      log(ts.running ? `Tailscale 已连接：${ts.ip}` : `Tailscale 状态：${ts.state}`)
    })
    startListening()
  })().catch((error) => {
    writeStatus({ stage: 'start-error', error: String(error && error.message || error) })
    log('启动失败：' + error.message)
  })

  try {
    ctx.effect?.(() => () => {
      clearInterval(tailscaleTimer)
      try { server.close() } catch {}
    })
  } catch {}
}
