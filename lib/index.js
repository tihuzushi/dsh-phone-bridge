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
import { execFileSync } from 'node:child_process'

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

const PAIR_WINDOW_MS = 10 * 60 * 1000
const PAIR_MAX_FAILURES = 8

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

  function pairBlocked(ip) {
    const record = pairFailures.get(ip)
    if (!record) return false
    if (Date.now() - record.first > PAIR_WINDOW_MS) {
      pairFailures.delete(ip)
      return false
    }
    return record.count >= PAIR_MAX_FAILURES
  }

  function recordPairFailure(ip) {
    const now = Date.now()
    const record = pairFailures.get(ip)
    if (!record || now - record.first > PAIR_WINDOW_MS) pairFailures.set(ip, { first: now, count: 1 })
    else record.count += 1
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

  function statusPayload() {
    const { lan, tailscale } = interfaces()
    return {
      ok: true,
      listening: server.listening === true,
      host: listenHost,
      port: activePort,
      preferredPort,
      autoPort: state.autoPort !== false,
      pairingCode: state.pairingCode,
      upstream: origin || null,
      addresses: [
        ...lan.map(({ ifName, address }) => ({ name: ifName, address, url: `http://${address}:${activePort}` })),
        ...tailscale.map((address) => ({ name: 'Tailscale', address, url: `http://${address}:${activePort}` })),
      ],
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
    const { lan, tailscale } = interfaces()
    const links = [
      ...lan.map(({ ifName, address }) => `<p>${ifName}: <a href="http://${address}:${activePort}/pair?code=${state.pairingCode}">http://${address}:${activePort}</a></p>`),
      ...tailscale.map((address) => `<p>Tailscale: <a href="http://${address}:${activePort}/pair?code=${state.pairingCode}">http://${address}:${activePort}</a></p>`),
    ]
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(page('手机配对', `
      <p>配对码：<code>${state.pairingCode}</code></p>
      ${links.join('') || '<p>未发现局域网地址。</p>'}
      <p>手机 App 里填上面的地址和配对码；局域网连同一个 Wi-Fi，外网两端登录同一个 Tailscale。</p>`))
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
        const originHeader = req.headers.origin || ''
        const allowOrigin = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(originHeader)
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': allowOrigin ? originHeader : 'null',
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
            'access-control-max-age': '600',
          })
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
          ...(allowOrigin ? { 'access-control-allow-origin': originHeader, vary: 'origin' } : {}),
        })
        res.end(JSON.stringify({ ok: true, restartNeeded: rebindNeeded }))
        if (rebindNeeded) setTimeout(() => rebind(state.port), 150)
        return
      }

      if (url.pathname === '/__dsh-phone/status') {
        if (!isLoopbackClient(req)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'loopback only' }))
          return
        }
        const originHeader = req.headers.origin || ''
        const allowOrigin = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(originHeader)
        const corsHeaders = allowOrigin ? {
          'access-control-allow-origin': originHeader,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-allow-private-network': 'true',
          vary: 'origin',
        } : {}
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { ...corsHeaders, 'access-control-max-age': '600' })
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders })
        res.end(JSON.stringify(statusPayload()))
        return
      }

      if (url.pathname === '/pair') {
        const ip = clientIp(req)
        if (pairBlocked(ip)) {
          res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '600' })
          res.end('配对尝试过于频繁，请 10 分钟后再试。\n')
          return
        }
        if (!safeEqual(url.searchParams.get('code') || '', state.pairingCode)) {
          recordPairFailure(ip)
          res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' })
          res.end(page('配对码不正确', '<p>请在电脑上打开 <code>http://127.0.0.1:' + activePort + '/_dsh-phone</code> 查看当前配对码。</p>'))
          return
        }
        pairFailures.delete(ip)
        const pairCookies = [`dsh_phone=${expectedPhoneCookie}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`]
        if (url.searchParams.get('hpv') === '2') {
          pairCookies.push('dsh_phone_ui=v2; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax')
        }
        res.writeHead(302, { 'cache-control': 'no-store', location: './', 'set-cookie': pairCookies })
        res.end()
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
      const { lan, tailscale } = interfaces()
      writeStatus({ stage: 'listening-ok', attempts: listenAttempts })
      saveState()
      log(`已监听 ${listenHost}:${activePort}`)
      for (const { ifName, address } of lan) log(`${ifName}: http://${address}:${activePort}/pair?code=${state.pairingCode}`)
      for (const address of tailscale) log(`Tailscale: http://${address}:${activePort}/pair?code=${state.pairingCode}`)
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

  ;(async () => {
    const resolved = await resolveUpstream()
    if (resolved) {
      setOrigin(resolved)
      log(`上游：${resolved}`)
    } else {
      log('没有识别到本机 Web GUI 端口，桥接会在首次请求时重试')
    }
    startListening()
  })().catch((error) => {
    writeStatus({ stage: 'start-error', error: String(error && error.message || error) })
    log('启动失败：' + error.message)
  })

  try {
    ctx.effect?.(() => () => {
      try { server.close() } catch {}
    })
  } catch {}
}
