// Dev harness: runs the host half of the plugin outside DSH against the live
// local web GUI, so the bridge can be exercised without restarting HARNESS.
import { apply } from '../lib/index.js'

const PORT = Number(process.env.TEST_PORT || 8799)
const health = await (await fetch('http://127.0.0.1:8765/__bridge/health')).json().catch(() => null)
const upstreamPort = Number(new URL(health?.upstream || 'http://127.0.0.1:50179').port)

const ctx = {
  get: (name) => (name === 'webServer' ? { port: upstreamPort } : undefined),
  effect: () => {},
  logger: () => ({ info: (...a) => console.log('[logger]', ...a) }),
}

apply(ctx, { port: PORT, host: '127.0.0.1' })
await new Promise((r) => setTimeout(r, 1500))

const base = `http://127.0.0.1:${PORT}`
const state = JSON.parse((await import('node:fs')).readFileSync(
  (await import('node:path')).join((await import('node:os')).homedir(), '.dsh', 'phone-bridge.json'), 'utf8'))
console.log('upstream port', upstreamPort, 'pair code', state.pairingCode)

async function probe(path, opts = {}) {
  const res = await fetch(base + path, { redirect: 'manual', ...opts })
  const text = await res.text().catch(() => '')
  return { status: res.status, headers: res.headers, text }
}

const unauth = await probe('/')
console.log('unauth / ->', unauth.status, /需要先配对/.test(unauth.text))

const status = await probe('/_dsh-phone')
console.log('status page ->', status.status, /配对码/.test(status.text), status.text.match(/<code>(\d{6})<\/code>/)?.[1])

const bad = await probe('/pair?code=000000')
console.log('bad code ->', bad.status)

const ok = await probe(`/pair?code=${state.pairingCode}&hpv=2`)
const cookie = (ok.headers.getSetCookie ? ok.headers.getSetCookie() : [ok.headers.get('set-cookie')]).filter(Boolean)
console.log('good code ->', ok.status, ok.headers.get('location'), 'cookies:', cookie.length)
const dshPhone = cookie.map((c) => c.split(';')[0]).join('; ')

const home = await probe('/', { headers: { cookie: dshPhone } })
console.log('home ->', home.status, 'len', home.text.length,
  'polyfill:', home.text.includes('dsh-phone-polyfill'),
  'viewport-fit:', home.text.includes('viewport-fit=cover'))

const health2 = await probe('/__bridge/health', { headers: { cookie: dshPhone } })
console.log('health ->', health2.status, health2.text)

process.exit(0)
