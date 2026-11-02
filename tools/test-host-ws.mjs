// Dev harness #2: WebSocket upgrade forwarding and file download through the
// host half, against the live DSH.
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../lib/index.js'

const PORT = Number(process.env.TEST_PORT || 8798)
const health = await (await fetch('http://127.0.0.1:8765/__bridge/health')).json().catch(() => null)
const upstreamPort = Number(new URL(health?.upstream || 'http://127.0.0.1:50179').port)

apply({ get: (n) => (n === 'webServer' ? { port: upstreamPort } : undefined), effect: () => {} }, { port: PORT, host: '127.0.0.1' })
await new Promise((r) => setTimeout(r, 1200))

const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'phone-bridge.json'), 'utf8'))
const pair = await fetch(`http://127.0.0.1:${PORT}/pair?code=${state.pairingCode}&hpv=2`, { redirect: 'manual' })
const cookies = pair.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

// 1. upgrade forwarding
await new Promise((resolve) => {
  const socket = net.connect(PORT, '127.0.0.1', () => {
    socket.write([
      'GET /api/remote.mux HTTP/1.1',
      `Host: 127.0.0.1:${PORT}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      `Cookie: ${cookies}`,
      '',
      '',
    ].join('\r\n'))
  })
  let data = ''
  socket.on('data', (chunk) => {
    data += chunk.toString('latin1')
    if (data.includes('\r\n\r\n')) {
      console.log('upgrade ->', data.split('\r\n')[0])
      socket.destroy()
      resolve()
    }
  })
  socket.on('error', (error) => { console.log('upgrade error:', error.message); resolve() })
  setTimeout(() => { socket.destroy(); console.log('upgrade -> timeout, got:', JSON.stringify(data.slice(0, 80))); resolve() }, 4000)
})

// 2. file download
const sample = path.join(os.tmpdir(), 'dsh-phone-test.txt')
fs.writeFileSync(sample, 'hello phone bridge')
const fileRes = await fetch(`http://127.0.0.1:${PORT}/__bridge/file?path=${encodeURIComponent(sample)}&name=sample.txt`, { headers: { cookie: cookies } })
console.log('file ->', fileRes.status, fileRes.headers.get('content-type'), JSON.stringify(await fileRes.text()))
fs.unlinkSync(sample)

process.exit(0)
