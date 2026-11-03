/* DSH Phone Assistant — settings section for the desktop client.
 *
 * The panel is rendered *inside* the stock `.AnXs9G_options` body, so the dialog
 * header (打开配置文件 / close), the section title metrics and the scroll area all
 * stay exactly as HARNESS renders them. Only the body children are swapped.
 */
function runSettingsSection() {
  if (window.__hpPhoneSettingsSection) return
  window.__hpPhoneSettingsSection = true

  let BRIDGE = null
  const PORT_CANDIDATES = Array.from({ length: 26 }, (_, i) => 8765 + i)
  const LAST_PORT_KEY = 'hp-phone-bridge-port'
  const LABEL = 'DSH Phone Assistant'
  const SUBTITLE = '配对码与手机服务状态'
  const APP_RELEASES_URL = 'https://github.com/tihuzushi/dsh-phone-bridge-app/releases/latest'

  let navButton = null
  let optionsHost = null
  let section = null
  let hidden = []
  let refreshTimer = null
  let data = null
  let failure = null
  let polling = false
  let active = false

  function el(tag, style, text) {
    const node = document.createElement(tag)
    if (style) node.setAttribute('style', style)
    if (text !== undefined) node.textContent = text
    return node
  }

  function copyButton(value) {
    const btn = el('button', 'flex:0 0 auto;border:1px solid var(--dsw-alias-border-l2, #3a3a40);background:transparent;color:var(--dsw-alias-label-primary, #ececf1);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;', '复制')
    btn.type = 'button'
    btn.addEventListener('click', () => {
      try {
        navigator.clipboard.writeText(value)
        btn.textContent = '已复制'
        setTimeout(() => { btn.textContent = '复制' }, 1500)
      } catch (_) {
        btn.textContent = '失败'
      }
    })
    return btn
  }

  function linkButton(text, href) {
    const a = el('a', 'display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2, #3a3a40);background:transparent;color:var(--dsw-alias-label-primary, #ececf1);border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;text-decoration:none;', text)
    a.href = href
    a.target = '_blank'
    a.rel = 'noreferrer noopener'
    a.addEventListener('click', (event) => {
      // The desktop app owns this window; hand the URL to the system browser
      // instead of navigating the app itself.
      try {
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
      } catch (_) {}
    })
    return a
  }

  function row(label, value, opts) {
    const wrap = el('div', 'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1, #2a2a2e);')
    wrap.appendChild(el('span', 'flex:0 0 92px;color:var(--dsw-alias-label-secondary, #9b9ba6);font-size:13px;', label))
    wrap.appendChild(el('span', 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:' + (opts && opts.mono ? '600 15px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace' : '13px/1.5 inherit') + ';color:var(--dsw-alias-label-primary, #ececf1);letter-spacing:' + (opts && opts.mono ? '0.08em' : 'normal') + ';', value))
    if (opts && opts.copy) wrap.appendChild(copyButton(opts.copy))
    return wrap
  }

  function card(title) {
    const box = el('div', 'border:1px solid var(--dsw-alias-border-l1, #2a2a2e);border-radius:14px;padding:4px 16px 2px;margin:0 0 16px;background:var(--dsw-alias-bg-layer-2, #1c1c20);')
    if (title) box.appendChild(el('div', 'padding:12px 0 0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary, #9b9ba6);', title))
    return box
  }

  function render() {
    if (!section) return
    section.textContent = ''

    const head = el('div', 'display:flex;align-items:center;gap:10px;')
    const title = el('h2', 'font-size:18px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary, #ececf1);', LABEL)
    title.className = 'XAL7Ya_heading'
    head.appendChild(title)
    const pill = el('span', 'display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1, #2a2a2e);color:var(--dsw-alias-label-secondary, #9b9ba6);')
    pill.appendChild(el('span', 'width:7px;height:7px;border-radius:50%;display:inline-block;background:' + (data ? '#2ecc71' : '#e74c3c') + ';'))
    pill.appendChild(document.createTextNode(data ? '运行中' : '未运行'))
    head.appendChild(pill)
    section.appendChild(head)

    section.appendChild(el('div', 'margin:6px 0 18px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary, #9b9ba6);', SUBTITLE))

    if (!data) {
      const box = card()
      box.appendChild(el('div', 'padding:12px 0 4px;font-size:14px;color:var(--dsw-alias-label-primary, #ececf1);', '手机服务没有在运行。'))
      box.appendChild(el('div', 'padding:0 0 12px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        failure || '插件没有启动监听，或者 8765 端口被占用。'))
      section.appendChild(box)
      section.appendChild(el('div', 'font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        '诊断文件：~/.dsh/phone-bridge-status.json'))
      return
    }

    const pair = card('配对')
    pair.appendChild(row('配对码', data.pairingCode, { mono: true, copy: data.pairingCode }))
    pair.appendChild(row('配对页', data.pairUrl || '', { copy: data.pairUrl || '' }))
    const pairRow = el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0 6px;')
    const regen = el('button', SMALL_BTN, '重新生成配对码')
    regen.type = 'button'
    regen.addEventListener('click', () => { regenerateCode(regen) })
    pairRow.appendChild(regen)
    const throttleLabel = el('label', 'display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary, #9b9ba6);cursor:pointer;')
    const throttleBox = el('input')
    throttleBox.type = 'checkbox'
    throttleBox.checked = data.throttle !== false
    throttleBox.style.accentColor = '#4d6bfe'
    throttleBox.addEventListener('change', () => { setThrottle(throttleBox.checked) })
    throttleLabel.appendChild(throttleBox)
    throttleLabel.appendChild(document.createTextNode('配对重试节流'))
    pairRow.appendChild(throttleLabel)
    pair.appendChild(pairRow)
    pair.appendChild(el('div', 'padding:0 0 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary, #9b9ba6);',
      data.throttle === false
        ? '节流已关闭：手机输错码重试时不会被限速，可以随便重试。'
        : '配对码不对时只把重试间隔拉长（最长 15 秒），不锁死；关掉这个开关就不再限速。'))
    section.appendChild(pair)

    const svc = card('服务')
    svc.appendChild(row('监听', data.host + ':' + data.port))
    if (data.upstream) svc.appendChild(row('上游', data.upstream))
    section.appendChild(svc)

    const portBox = card('端口')
    const note = data.port !== data.preferredPort
      ? '偏好端口 ' + data.preferredPort + ' 被占用，已自动改用 ' + data.port + '。'
      : '当前使用 ' + data.port + '。'
    portBox.appendChild(el('div', 'padding:10px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#9b9ba6);', note))
    const controls = el('div', 'display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 0 12px;')
    const input = el('input', 'width:92px;padding:5px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#3a3a40);background:transparent;color:var(--dsw-alias-label-primary,#ececf1);font-size:13px;')
    input.type = 'number'
    input.min = '1024'
    input.max = '65535'
    input.value = String(data.preferredPort)
    const label = el('label', 'display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--dsw-alias-label-secondary,#9b9ba6);')
    const checkbox = el('input')
    checkbox.type = 'checkbox'
    checkbox.checked = data.autoPort !== false
    label.appendChild(checkbox)
    label.appendChild(document.createTextNode('被占用时自动换端口'))
    const apply = el('button', 'border:1px solid var(--dsw-alias-border-l2,#3a3a40);background:transparent;color:var(--dsw-alias-label-primary,#ececf1);border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer;', '应用')
    apply.type = 'button'
    apply.addEventListener('click', async () => {
      const next = Number(input.value)
      if (!(next >= 1024 && next <= 65535)) {
        apply.textContent = '端口无效'
        setTimeout(() => { apply.textContent = '应用' }, 1500)
        return
      }
      apply.textContent = '应用中…'
      try {
        await fetch(BRIDGE + '/__dsh-phone/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ port: next, autoPort: checkbox.checked }),
        })
        apply.textContent = '已应用'
        setTimeout(() => { apply.textContent = '应用' }, 1500)
        setTimeout(() => { refresh() }, 1200)
      } catch (_) {
        apply.textContent = '失败'
        setTimeout(() => { apply.textContent = '应用' }, 1500)
      }
    })
    controls.appendChild(input)
    controls.appendChild(label)
    controls.appendChild(apply)
    portBox.appendChild(controls)
    section.appendChild(portBox)

    // Only Tailscale is offered: the phone app ships its own tailnet node, so a
    // LAN address would work on one Wi-Fi and nowhere else.
    const ts = data.tailscale || { state: 'checking' }
    const tsCard = card('Tailscale')
    const dotColor = ts.state === 'running' ? '#2ecc71' : (ts.state === 'not-installed' ? '#e74c3c' : '#e6b422')
    const stateText = ts.state === 'running' ? '已连接'
      : ts.state === 'not-installed' ? '这台电脑没有安装'
      : ts.state === 'needs-login' ? '已安装，但没有登录'
      : ts.state === 'stopped' ? '已安装，但没有连接'
      : '正在检测'
    const statusRow = el('div', 'display:flex;align-items:center;gap:8px;padding:12px 0 10px;')
    statusRow.appendChild(el('span', 'width:8px;height:8px;border-radius:50%;display:inline-block;background:' + dotColor + ';'))
    statusRow.appendChild(el('span', 'font-size:14px;color:var(--dsw-alias-label-primary, #ececf1);', stateText))
    if (ts.version) statusRow.appendChild(el('span', 'font-size:12px;color:var(--dsw-alias-label-secondary, #9b9ba6);', ts.version))
    tsCard.appendChild(statusRow)

    if (ts.state === 'running') {
      // The phone carries its own tailnet node and discovers this machine through
      // the account, so the address is not something anyone has to type.
      if (ts.hostname) tsCard.appendChild(row('设备', ts.hostname))
      tsCard.appendChild(el('div', 'padding:10px 0 12px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        '手机端登录同一个 Tailscale 账号，在设备列表里选这台电脑，再填配对码。'))
    } else if (ts.state === 'not-installed') {
      tsCard.appendChild(el('div', 'padding:0 0 10px;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        '手机端已经带了自己的 Tailscale 节点，但电脑这一端需要装一个并登录同一账号，手机才连得回来。'))
      tsCard.appendChild(linkButton('下载安装 Tailscale', ts.downloadUrl || 'https://tailscale.com/download/windows'))
      tsCard.appendChild(el('div', 'padding:8px 0 12px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        '装好并登录后回到这里，状态会自动变成“已连接”。'))
    } else {
      tsCard.appendChild(el('div', 'padding:0 0 10px;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        '在电脑上打开 Tailscale，登录并点“Connect”；连上以后手机才能找到这台电脑。'))
      tsCard.appendChild(linkButton('打开 Tailscale 管理后台', 'https://login.tailscale.com/admin/machines'))
    }
    section.appendChild(tsCard)

    const appCard = card('APP 客户端')
    appCard.appendChild(el('div', 'padding:10px 0 6px;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
      '手机端安装 DSH Phone Bridge。APK 自带 Tailscale 节点，手机不用再装 Tailscale App，登录同一账号后就能找到这台电脑。'))
    appCard.appendChild(linkButton('下载 APP 客户端', APP_RELEASES_URL))
    appCard.appendChild(el('div', 'padding:10px 0 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary, #9b9ba6);word-break:break-all;',
      APP_RELEASES_URL))
    section.appendChild(appCard)

    const verCard = card('版本')
    verCard.appendChild(row('当前版本', (data.version || '未知') + (data.build ? '  ·  ' + data.build : '')))
    const verRow = el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0 12px;')
    const checkBtn = el('button', SMALL_BTN + (updateState.checking ? 'opacity:.6;cursor:default;' : ''),
      updateState.checking ? '检查更新中…' : (updateState.hasUpdate ? '有更新可用' : '检查更新'))
    checkBtn.type = 'button'
    checkBtn.addEventListener('click', () => { checkForUpdate() })
    verRow.appendChild(checkBtn)
    if (updateState.note) {
      verRow.appendChild(el('span', 'font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary, #9b9ba6);', updateState.note))
    }
    verCard.appendChild(verRow)
    verCard.appendChild(el('div', 'padding:0 0 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary, #9b9ba6);',
      '从 GitHub 仓库检查新版本，可以直接替换当前安装的文件；替换后重启 DeepSeek Harness 生效。'))
    section.appendChild(verCard)
  }

  const SMALL_BTN = 'border:1px solid var(--dsw-alias-border-l2,#3a3a40);background:transparent;color:var(--dsw-alias-label-primary,#ececf1);border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer;'

  let updateState = { checking: false, note: '', hasUpdate: false }

  function bridgeBase() {
    return BRIDGE || ('http://127.0.0.1:' + (data && data.port ? data.port : 8765))
  }

  // Rotating the code also clears the retry throttle state, so a stale code on the
  // phone can never leave it stuck.
  async function regenerateCode(button) {
    if (button.disabled) return
    button.disabled = true
    const label = button.textContent
    button.textContent = '正在生成…'
    try {
      const res = await fetch(bridgeBase() + '/__dsh-phone/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      })
      const info = await res.json()
      if (!info.ok) throw new Error(info.error || '生成失败')
      await refresh()
    } catch (error) {
      button.disabled = false
      button.textContent = '生成失败'
      setTimeout(() => { button.textContent = label }, 1800)
    }
  }

  async function setThrottle(enabled) {
    try {
      await fetch(bridgeBase() + '/__dsh-phone/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ throttle: enabled, rotate: false }),
        cache: 'no-store',
      })
      await refresh()
    } catch (_) {}
  }

  async function checkForUpdate() {
    if (updateState.checking) return
    updateState = { checking: true, note: '', hasUpdate: false }
    render()
    try {
      const base = bridgeBase()
      const res = await fetch(base + '/__dsh-phone/update?t=' + Date.now(), { cache: 'no-store' })
      const info = await res.json()
      if (!info.ok) throw new Error(info.error || '检查失败')
      if (!info.hasUpdate) {
        updateState = { checking: false, hasUpdate: false, note: '已是最新版本 ' + info.current }
        render()
        return
      }
      updateState = { checking: false, hasUpdate: true, note: '发现新版本 ' + info.latest + '（当前 ' + info.current + '）' }
      render()
      openUpdateDialog(info)
    } catch (error) {
      updateState = { checking: false, hasUpdate: false, note: '检查更新失败：' + ((error && error.message) || error) }
      render()
    }
  }

  let updateDialog = null

  function closeUpdateDialog() {
    if (updateDialog && updateDialog.parentElement) updateDialog.parentElement.removeChild(updateDialog)
    updateDialog = null
  }

  function dialogShell(title) {
    closeUpdateDialog()
    const overlay = el('div', 'position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);')
    const box = el('div', 'width:min(440px,calc(100vw - 40px));border:1px solid var(--dsw-alias-border-l1,#2a2a2e);border-radius:16px;background:var(--dsw-alias-bg-layer-2,#1c1c20);color:var(--dsw-alias-label-primary,#ececf1);padding:20px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.55);')
    const heading = el('div', 'font-size:16px;font-weight:600;margin:0 0 10px;', title)
    box.appendChild(heading)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    updateDialog = overlay
    return { overlay, box, heading }
  }

  function openUpdateDialog(info) {
    const { box } = dialogShell('发现新版本 ' + info.latest)
    box.appendChild(el('div', 'font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#9b9ba6);',
      '当前版本 ' + info.current + '，仓库里是 ' + info.latest + '。点击“立即更新”会从 GitHub 下载并替换已安装的文件，完成后重启 DeepSeek Harness 生效。'))
    const actions = el('div', 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px;')
    const later = el('button', SMALL_BTN + 'padding:6px 14px;', '稍后')
    later.type = 'button'
    later.addEventListener('click', closeUpdateDialog)
    const now = el('button', 'border:1px solid var(--dsw-alias-state-business-primary,#4d6bfe);background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;', '立即更新')
    now.type = 'button'
    now.addEventListener('click', () => { runUpdate(now) })
    actions.appendChild(later)
    actions.appendChild(now)
    box.appendChild(actions)
  }

  async function runUpdate(button) {
    if (button.disabled) return
    button.disabled = true
    button.textContent = '更新中…'
    try {
      const base = bridgeBase()
      const res = await fetch(base + '/__dsh-phone/update', { method: 'POST', cache: 'no-store' })
      const info = await res.json()
      if (!info.ok) throw new Error(info.error || '更新失败')
      if (!info.updated) {
        const { box } = dialogShell('已经是最新版本')
        box.appendChild(el('div', 'font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#9b9ba6);',
          '当前已经是 ' + info.to + '，不需要更新。'))
        appendDone(box)
        return
      }
      const { box } = dialogShell('更新完成')
      box.appendChild(el('div', 'font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#9b9ba6);',
        '已从 ' + info.from + ' 更新到 ' + info.to + '。重启 DeepSeek Harness 即可完成更新。'))
      appendDone(box)
    } catch (error) {
      button.disabled = false
      button.textContent = '重试'
      const { box } = dialogShell('更新失败')
      box.appendChild(el('div', 'font-size:13px;line-height:1.7;color:#e05c5c;', String((error && error.message) || error)))
      appendDone(box)
    }
  }

  function appendDone(box) {
    const actions = el('div', 'display:flex;justify-content:flex-end;margin-top:18px;')
    const done = el('button', 'border:1px solid var(--dsw-alias-state-business-primary,#4d6bfe);background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;', '知道了')
    done.type = 'button'
    done.addEventListener('click', closeUpdateDialog)
    actions.appendChild(done)
    box.appendChild(actions)
  }

  // A <script> tag is not subject to CORS, so JSONP reaches the bridge from the
  // desktop window too (its origin is dsh-app://app, not the loopback server).
  let jsonpSeq = 0
  function jsonpStatus(base, timeout) {
    return new Promise((resolve) => {
      const name = '__hpStatus' + (++jsonpSeq) + Date.now().toString(36)
      const script = document.createElement('script')
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { delete window[name] } catch (_) { window[name] = undefined }
        try { script.remove() } catch (_) {}
        resolve(value)
      }
      const timer = setTimeout(() => finish(null), timeout || 800)
      window[name] = (payload) => finish(payload && payload.ok ? payload : null)
      script.onerror = () => finish(null)
      script.src = base + '/__dsh-phone/status.js?cb=' + encodeURIComponent(name) + '&t=' + Date.now()
      ;(document.head || document.documentElement).appendChild(script)
    })
  }

  async function readStatus(base) {
    const viaJsonp = await jsonpStatus(base)
    if (viaJsonp) return viaJsonp
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 600)
    try {
      const res = await fetch(base + '/__dsh-phone/status?t=' + Date.now(), { signal: controller.signal })
      if (!res.ok) return null
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  function portOrder() {
    const remembered = Number(localStorage.getItem(LAST_PORT_KEY) || 0)
    const all = PORT_CANDIDATES.map((p) => 'http://127.0.0.1:' + p)
    const first = []
    if (BRIDGE) first.push(BRIDGE)
    if (remembered >= 1024) first.push('http://127.0.0.1:' + remembered)
    return [...first, ...all.filter((url) => !first.includes(url))]
  }

  async function refresh() {
    if (polling) return
    polling = true
    try {
      // Preferred path: the host inlined the status into this page.
      if (window.__HP_STATUS__ && window.__HP_STATUS__.pairingCode) {
        data = window.__HP_STATUS__
        failure = null
        polling = false
        render()
        return
      }
      // The bridge may move to another port when 8765 is taken, so probe the range.
      const candidates = portOrder()
      let payload = null
      let firstError = null
      let tried = 0
      for (const base of candidates) {
        tried += 1
        try {
          payload = await readStatus(base)
          if (payload) {
            BRIDGE = base
            try { localStorage.setItem(LAST_PORT_KEY, String(new URL(base).port)) } catch (_) {}
            break
          }
        } catch (error) {
          if (!firstError) firstError = String((error && error.message) || error)
        }
      }
      data = payload
      failure = payload ? null : ('没有找到正在运行的手机服务（试了 ' + tried + ' 个端口）。首个错误：' + (firstError || '无') + '｜页面来源：' + location.origin)
      // The host knows which client bundle it ships; reload once when we are stale.
      try {
        const mine = typeof BUILD !== 'undefined' ? BUILD : null
        if (payload && payload.clientRev && mine && payload.clientRev !== mine && !sessionStorage.getItem('hp-phone-autoreload')) {
          sessionStorage.setItem('hp-phone-autoreload', '1')
          setTimeout(() => location.reload(), 300)
        }
      } catch (_) {}
    } catch (error) {
      data = null
      failure = '连不上手机服务（' + (error && error.message ? error.message : 'unknown') + '）。'
    } finally {
      polling = false
      render()
    }
  }

  function ensureNodes() {
    if (!navButton) {
      navButton = el('button', '', '')
      navButton.type = 'button'
      navButton.className = 'AnXs9G_navCell hp-ps-nav'
      navButton.innerHTML = '<svg width="16" height="16" class="AnXs9G_navIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="4.2" y="1.8" width="7.6" height="12.4" rx="2"/><path d="M6.8 12.6h2.4"/></svg>'
      const label = el('span', 'font-size:12px;letter-spacing:-0.01em;', LABEL)
      label.className = 'AnXs9G_navLabel'
      navButton.appendChild(label)
      navButton.addEventListener('click', () => activate())
    }
    if (!section) {
      section = el('div', 'min-width:0;')
      section.className = 'hp-ps-section'
    }
  }

  function deactivate() {
    active = false
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
    if (navButton) {
      navButton.classList.remove('AnXs9G_active')
      navButton.removeAttribute('aria-current')
    }
    if (section && section.parentElement) section.parentElement.removeChild(section)
    for (const node of hidden) node.style.removeProperty('display')
    hidden = []
  }

  function activate() {
    ensureNodes()
    const panel = document.querySelector('.AnXs9G_panel')
    optionsHost = panel && panel.querySelector('.AnXs9G_options')
    if (!optionsHost) return
    active = true
    for (const child of [...optionsHost.children]) {
      if (child === section) continue
      child.style.setProperty('display', 'none', 'important')
      if (!hidden.includes(child)) hidden.push(child)
    }
    if (section.parentElement !== optionsHost) optionsHost.insertBefore(section, optionsHost.firstChild)
    navButton.classList.add('AnXs9G_active')
    navButton.setAttribute('aria-current', 'true')
    render()
    refresh()
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = setInterval(refresh, 3000)
  }

  function mount() {
    const panel = document.querySelector('.AnXs9G_panel')
    if (!panel) {
      if (active) deactivate()
      return
    }
    const navList = panel.querySelector('.AnXs9G_navList')
    if (!navList) return
    ensureNodes()
    if (!navList.contains(navButton)) navList.appendChild(navButton)
    for (const cell of navList.querySelectorAll('button.AnXs9G_navCell')) {
      if (cell === navButton || cell.dataset.hpBound === '1') continue
      cell.dataset.hpBound = '1'
      cell.addEventListener('click', () => { if (active) deactivate() })
    }
    if (active) {
      const host = panel.querySelector('.AnXs9G_options')
      if (host && section.parentElement !== host) {
        optionsHost = host
        for (const child of [...host.children]) {
          if (child === section) continue
          child.style.setProperty('display', 'none', 'important')
          if (!hidden.includes(child)) hidden.push(child)
        }
        host.insertBefore(section, host.firstChild)
      }
    }
  }

  setInterval(mount, 800)
  mount()
}
