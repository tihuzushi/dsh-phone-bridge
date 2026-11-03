/* DSH Phone Assistant — settings section for the desktop (non-phone) client.
 *
 * Renders a dedicated section inside the HARNESS settings dialog that shows the
 * pairing code and the live state of the phone bridge. Everything is inline
 * styled so it does not depend on the app's hashed CSS module class names.
 */
function runSettingsSection() {
  const BRIDGE = 'http://127.0.0.1:8765'
  const SECTION_LABEL = 'DSH Phone Assistant'

  let section = null
  let navButton = null
  let contentHost = null
  let refreshTimer = null
  let lastData = null
  let lastError = null
  let polling = false

  function el(tag, style, text) {
    const node = document.createElement(tag)
    if (style) node.setAttribute('style', style)
    if (text !== undefined) node.textContent = text
    return node
  }

  function row(label, value, opts) {
    const wrap = el('div', 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1, #2a2a2e);')
    wrap.appendChild(el('span', 'flex:0 0 88px;color:var(--dsw-alias-label-secondary, #9b9ba6);font-size:13px;', label))
    wrap.appendChild(el('span', `flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:${opts && opts.mono ? '600 15px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace' : '13px/1.5 inherit'};color:var(--dsw-alias-label-primary, #ececf1);letter-spacing:${opts && opts.mono ? '0.08em' : 'normal'};`, value))
    if (opts && opts.copy) {
      const btn = el('button', 'flex:0 0 auto;border:1px solid var(--dsw-alias-border-l2, #3a3a40);background:transparent;color:var(--dsw-alias-label-primary, #ececf1);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;', '复制')
      btn.type = 'button'
      btn.addEventListener('click', () => {
        try {
          navigator.clipboard.writeText(opts.copy)
          btn.textContent = '已复制'
          setTimeout(() => { btn.textContent = '复制' }, 1500)
        } catch (_) {
          btn.textContent = '复制失败'
        }
      })
      wrap.appendChild(btn)
    }
    return wrap
  }

  function card(title) {
    const box = el('div', 'border:1px solid var(--dsw-alias-border-l1, #2a2a2e);border-radius:14px;padding:6px 16px;margin:0 0 16px;background:var(--dsw-alias-bg-layer-2, #1c1c20);')
    if (title) box.appendChild(el('div', 'padding:12px 0 2px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary, #9b9ba6);letter-spacing:0.02em;', title))
    return box
  }

  function render() {
    if (!section) return
    section.textContent = ''

    const head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 18px;')
    head.appendChild(el('div', 'font-size:20px;font-weight:650;color:var(--dsw-alias-label-primary, #ececf1);', SECTION_LABEL))
    const dot = el('span', `width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px;background:${lastData ? '#2ecc71' : '#e74c3c'};`)
    const state = el('span', 'display:inline-flex;align-items:center;font-size:13px;color:var(--dsw-alias-label-secondary, #9b9ba6);')
    state.appendChild(dot)
    state.appendChild(document.createTextNode(lastData ? '运行中' : '未运行'))
    head.appendChild(state)
    section.appendChild(head)

    if (!lastData) {
      const box = card()
      box.appendChild(el('div', 'padding:14px 0;font-size:14px;color:var(--dsw-alias-label-primary, #ececf1);', '手机服务没有在运行。'))
      box.appendChild(el('div', 'padding:0 0 14px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        lastError || '插件没有启动监听，或者 8765 端口被占用。重启 HARNESS 后再看这里。'))
      section.appendChild(box)
      section.appendChild(el('div', 'font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
        '诊断文件：~/.dsh/phone-bridge-status.json'))
      return
    }

    const pairCard = card('配对码')
    pairCard.appendChild(row('码', lastData.pairingCode, { mono: true, copy: lastData.pairingCode }))
    pairCard.appendChild(row('配对页', lastData.pairUrl || '', { copy: lastData.pairUrl || '' }))
    section.appendChild(pairCard)

    const svc = card('服务')
    svc.appendChild(row('监听', `${lastData.host}:${lastData.port}`))
    if (lastData.upstream) svc.appendChild(row('上游', lastData.upstream))
    section.appendChild(svc)

    if (lastData.addresses && lastData.addresses.length) {
      const addr = card('连接地址')
      for (const item of lastData.addresses) {
        addr.appendChild(row(item.name, item.url, { copy: item.url }))
      }
      section.appendChild(addr)
    }

    section.appendChild(el('div', 'font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary, #9b9ba6);',
      '在手机的 HARNESS Phone 里填上面任意一个地址 + 配对码即可连接。局域网连同一个 Wi-Fi，外网两端登录同一个 Tailscale。'))
  }

  async function refresh() {
    if (polling) return
    polling = true
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      const res = await fetch(`${BRIDGE}/__dsh-phone/status`, { cache: 'no-store', signal: controller.signal })
      clearTimeout(timer)
      lastData = res.ok ? await res.json() : null
      lastError = res.ok ? null : `状态接口返回 ${res.status}`
    } catch (error) {
      lastData = null
      lastError = '连不上本机的 8765 端口：' + (error && error.message ? error.message : 'unknown')
    } finally {
      polling = false
      render()
    }
  }

  function buildSection() {
    navButton = el('button', '', '')
    navButton.type = 'button'
    navButton.className = 'AnXs9G_navCell hp-ps-nav'
    navButton.setAttribute('data-hp-section', 'phone-assistant')
    navButton.innerHTML = '<svg width="16" height="16" class="AnXs9G_navIcon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="4.2" y="1.8" width="7.6" height="12.4" rx="2"/><path d="M6.8 12.6h2.4"/></svg>'
    navButton.appendChild(el('span', 'font-size:12px;letter-spacing:-0.01em;', SECTION_LABEL))
    navButton.lastChild.className = 'AnXs9G_navLabel'

    section = el('div', 'display:none;flex:1 1 auto;min-width:0;overflow:auto;padding:4px 0 24px;')
    section.className = 'hp-ps-section'

    navButton.addEventListener('click', () => {
      show(true)
      refresh()
    })
    return navButton
  }

  function show(active) {
    const panel = document.querySelector('.AnXs9G_panel')
    if (!panel) return
    contentHost = panel.querySelector('.AnXs9G_content')
    if (!navButton || !section) return

    if (active) {
      if (contentHost) contentHost.style.setProperty('display', 'none', 'important')
      section.style.display = 'block'
      navButton.classList.add('AnXs9G_active')
      navButton.setAttribute('aria-current', 'true')
      if (refreshTimer) clearInterval(refreshTimer)
      refreshTimer = setInterval(refresh, 3000)
    } else {
      if (contentHost) contentHost.style.removeProperty('display')
      section.style.display = 'none'
      navButton.classList.remove('AnXs9G_active')
      navButton.removeAttribute('aria-current')
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
    }
  }

  function mount() {
    const panel = document.querySelector('.AnXs9G_panel')
    const navList = panel && panel.querySelector('.AnXs9G_navList')
    if (!navList) return false

    if (!navButton) buildSection()

    if (!navList.contains(navButton)) {
      navList.appendChild(navButton)
      // other nav cells take control back
      for (const cell of navList.querySelectorAll('button.AnXs9G_navCell')) {
        if (cell === navButton) continue
        if (cell.dataset.hpBound === '1') continue
        cell.dataset.hpBound = '1'
        cell.addEventListener('click', () => show(false))
      }
    }
    if (!panel.contains(section)) panel.appendChild(section)
    return true
  }

  function tick() {
    if (!mount()) return
    if (!section) return
    // Only poll while the section is on screen.
    if (section.style.display === 'block' && !refreshTimer) refreshTimer = setInterval(refresh, 3000)
    if (section.style.display !== 'block' && refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  }

  setInterval(tick, 800)
  const observer = new MutationObserver(() => { mount() })
  observer.observe(document.body, { childList: true, subtree: true })
}
