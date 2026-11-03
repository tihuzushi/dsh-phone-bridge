/* DSH Phone Assistant — settings section for the desktop client.
 *
 * The panel is rendered *inside* the stock `.AnXs9G_options` body, so the dialog
 * header (打开配置文件 / close), the section title metrics and the scroll area all
 * stay exactly as HARNESS renders them. Only the body children are swapped.
 */
function runSettingsSection() {
  if (window.__hpPhoneSettingsSection) return
  window.__hpPhoneSettingsSection = true

  const BRIDGE = 'http://127.0.0.1:8765'
  const LABEL = 'DSH Phone Assistant'
  const SUBTITLE = '配对码与手机服务状态'

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

    const pair = card('配对码')
    pair.appendChild(row('码', data.pairingCode, { mono: true, copy: data.pairingCode }))
    pair.appendChild(row('配对页', data.pairUrl || '', { copy: data.pairUrl || '' }))
    section.appendChild(pair)

    const svc = card('服务')
    svc.appendChild(row('监听', data.host + ':' + data.port))
    if (data.upstream) svc.appendChild(row('上游', data.upstream))
    section.appendChild(svc)

    if (data.addresses && data.addresses.length) {
      const addr = card('连接地址')
      for (const item of data.addresses) addr.appendChild(row(item.name, item.url, { copy: item.url }))
      section.appendChild(addr)
    }

    section.appendChild(el('div', 'font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
      '在手机的 HARNESS Phone 里填上面任意一个地址 + 配对码即可连接。同一个 Wi-Fi 用局域网地址，外网两端登录同一个 Tailscale。'))
  }

  async function refresh() {
    if (polling) return
    polling = true
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      const res = await fetch(BRIDGE + '/__dsh-phone/status', { cache: 'no-store', signal: controller.signal })
      clearTimeout(timer)
      data = res.ok ? await res.json() : null
      failure = res.ok ? null : '状态接口返回 ' + res.status
    } catch (error) {
      data = null
      failure = '连不上本机的 8765 端口（' + (error && error.message ? error.message : 'unknown') + '）。'
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
