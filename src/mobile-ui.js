(function () {
  if (window.__hpMobileReady) return;
  window.__hpMobileReady = true;

  const root = document.documentElement;
  root.classList.add('hp-mobile');

  const THEME_KEY = 'harness-phone-theme';
  let themePref = localStorage.getItem(THEME_KEY) || 'system';
  try {
    if (window.HarnessNative && typeof window.HarnessNative.getThemePreference === 'function') {
      const saved = window.HarnessNative.getThemePreference();
      if (saved === 'light' || saved === 'dark' || saved === 'system') themePref = saved;
    }
  } catch (_) {}

  function nativeTheme() {
    try {
      if (window.HarnessNative && typeof window.HarnessNative.systemTheme === 'function') {
        return window.HarnessNative.systemTheme();
      }
    } catch (_) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function effectiveDark() {
    if (themePref === 'dark') return true;
    if (themePref === 'light') return false;
    return nativeTheme() === 'dark';
  }

  function isEnglishUi() {
    return (document.documentElement.lang || '').toLowerCase().startsWith('en')
      || (() => { try { return localStorage.getItem('hp-locale') === 'en'; } catch (_) { return false; } })();
  }

  const CUSTOM_EN = {
    '外观': 'Appearance',
    '浅色': 'Light',
    '深色': 'Dark',
    '跟随系统': 'System',
    '连接设置': 'Connection settings',
    'Tailscale 账号': 'Tailscale account',
    '连接设备': 'Device',
    '当前连接': 'Current connection',
    '刷新': 'Refresh',
    '刷新页面': 'Refresh',
    '重新配对': 'Re-pair',
    '登录 Tailscale': 'Sign in to Tailscale',
    '退出登录': 'Sign out',
    '保存并连接': 'Save and connect',
    '取消': 'Cancel',
    '连接': 'Connect',
    '配对码': 'Pairing code',
    '6 位数字': '6-digit code',
    '登录后会自动从 Tailscale 账号读取设备。': 'Devices will be read from your Tailscale account after sign-in.',
    '正在读取状态…': 'Reading status…',
    '正在检查连接…': 'Checking connection…',
    '尚未连接': 'Not connected',
    '需要登录 Tailscale': 'Tailscale sign-in required',
    'Tailscale 已连接': 'Tailscale connected',
    '已连接 Tailscale': 'Tailscale connected',
    '下载的文件': 'Downloaded files',
    '用文件管理器打开下载文件夹': 'Open the Downloads folder in your file manager.',
    '字号大小': 'Font size',
    '仅影响 App 内的会话内容字号。': 'Affects only conversation text in this app.',
    '正文字体': 'Body font',
    '用于界面与会话正文。多个字体用逗号分隔，留空使用默认字体': 'Used for UI and conversation text. Separate fonts with commas; leave empty for default.',
    '代码字体': 'Code font',
    '用于代码块、行内代码与工具输出。多个字体用逗号分隔': 'Used for code blocks, inline code and tool output. Separate fonts with commas.',
    '代码字号': 'Code font size',
    '用于代码块、行内代码与工具输出': 'Used for code blocks, inline code and tool output.',
    '终端字体': 'Terminal font',
    '用于侧栏终端。多个字体用逗号分隔，留空使用默认字体': 'Used for the sidebar terminal. Separate fonts with commas; leave empty for default.',
    '终端字号': 'Terminal font size',
    '用于侧栏终端': 'Used for the sidebar terminal.',
  };

  function localizeCustomUi() {
    const english = isEnglishUi();
    document.querySelectorAll('.hp-appearance, #hp-connection-panel, .hp-connection-nav, .hp-download-row, .hp-local-font-row, .hp-font-extra')
      .forEach((rootNode) => {
        const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const raw = node.nodeValue || '';
          const key = raw.trim();
          if (!key) continue;
          if (!english) {
            node.__hpZh = raw;
            continue;
          }
          const source = node.__hpZh || raw;
          const sourceKey = source.trim();
          const translated = CUSTOM_EN[sourceKey];
          if (translated && raw.trim() !== translated) {
            node.nodeValue = raw.replace(sourceKey, translated);
          }
        }
        if (english) {
          rootNode.querySelectorAll('[placeholder],[aria-label],[title]').forEach((element) => {
            ['placeholder', 'aria-label', 'title'].forEach((attribute) => {
              const value = element.getAttribute(attribute);
              if (value && CUSTOM_EN[value]) element.setAttribute(attribute, CUSTOM_EN[value]);
            });
          });
        }
      });
  }

  let lastUiLocale = (document.documentElement.lang || 'zh').slice(0, 2);

  function resetCustomUiForLocale() {
    if (typeof connectionPanel !== 'undefined' && connectionPanel) {
      try { connectionPanel.remove(); } catch (_) {}
    }
    if (typeof previousActiveNav !== 'undefined') previousActiveNav = null;
    document.querySelectorAll('.hp-appearance, .hp-local-font-row, .hp-font-extra, .hp-download-row, .hp-connection-nav, #hp-connection-panel')
      .forEach((node) => node.remove());
    if (typeof connectionPanel !== 'undefined') connectionPanel = null;
    const panel = document.querySelector('.AnXs9G_panel');
    if (panel) injectSettingsCard();
    else {
      document.querySelectorAll('.Iwzhua_group, ._7qxJPq_row').forEach((node) => node.style.removeProperty('display'));
    }
    localizeCustomUi();
    applyLocalFontSize(localFontSize());
  }

  function checkUiLocale(force) {
    const current = (document.documentElement.lang || 'zh').slice(0, 2);
    if (!force && current === lastUiLocale) return;
    lastUiLocale = current;
    resetCustomUiForLocale();
  }

  window.addEventListener('hp-locale-change', () => checkUiLocale(true));
  setInterval(() => checkUiLocale(false), 250);

  function applyTheme() {
    const dark = effectiveDark();
    if (document.body) {
      if (document.body.hasAttribute('data-ds-dark-theme') !== dark) {
        document.body.toggleAttribute('data-ds-dark-theme', dark);
      }
    }
    root.style.colorScheme = dark ? 'dark' : 'light';
    try {
      if (window.HarnessNative && typeof window.HarnessNative.setSystemBarsDark === 'function') {
        window.HarnessNative.setSystemBarsDark(dark);
      }
    } catch (_) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#151517' : '#ffffff');
    document.querySelectorAll('.hp-appearance [data-hp-theme]').forEach((button) => {
      button.classList.toggle('hp-selected', button.getAttribute('data-hp-theme') === themePref);
    });
  }

  function setTheme(value) {
    themePref = value;
    localStorage.setItem(THEME_KEY, value);
    try {
      if (window.HarnessNative && typeof window.HarnessNative.setThemePreference === 'function') {
        window.HarnessNative.setThemePreference(value);
      }
    } catch (_) {}
    applyTheme();
  }

  window.__hpSystemThemeChanged = applyTheme;
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (themePref === 'system') applyTheme();
      });
    } catch (_) {}
  }

  new MutationObserver(() => {
    if (document.body && document.body.hasAttribute('data-ds-dark-theme') !== effectiveDark()) {
      document.body.toggleAttribute('data-ds-dark-theme', effectiveDark());
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-ds-dark-theme'] });

  /* ---------------- in-header menu button / sidebar drawer ---------------- */
  const backdrop = document.createElement('button');
  backdrop.id = 'hp-backdrop';
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', '关闭侧边栏');
  document.body.appendChild(backdrop);

  function toggleSidebar() {
    const button = sidebarToggle();
    if (button) {
      button.click();
      return;
    }
    // Plugin and automation pages may not expose a DSH sidebar toggle.
    if (window.history.length > 1) window.history.back();
  }

  backdrop.addEventListener('click', toggleSidebar);

  let frame = null;
  let rightbarManual = false;
  let rightbarOpenedAt = 0;
  let rightbarSuppressedUntil = 0;
  let rightbarFile = { name: '', url: '', mime: '' };
  function sidebarToggle() {
    return document.querySelector('.wtg9ga_toggle') ||
      Array.from(document.querySelectorAll('button[aria-label]')).find((b) =>
        /打开侧边栏|收起侧边栏|Open sidebar|Collapse sidebar/i.test(b.getAttribute('aria-label') || ''));
  }

  function sidebarIsOpen() {
    const button = sidebarToggle();
    if (!button) return false;
    return /收起侧边栏|Collapse sidebar/i.test(button.getAttribute('aria-label') || '');
  }

  function isImageFile(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(String(name || ''));
  }

  function rightbarIsOpen() {
    if (Date.now() < rightbarSuppressedUntil) return false;
    if (rightbarManual) return true;
    const button = Array.from(document.querySelectorAll('button[aria-label]')).find((b) =>
      /收起右侧边栏|Close right sidebar/i.test(b.getAttribute('aria-label') || ''));
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth && rect.right > 0;
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.hp-file-action') || event.target.closest('#hp-rightbar-toolbar')) return;
    const imageHost = event.target.closest('img')
      || (event.target.closest('button,a,[role="button"]')
        && event.target.closest('button,a,[role="button"]').querySelector('img'));
    if (imageHost) {
      // Image preview is a DSH lightbox, not the file right sidebar.
      if (rightbarManual) closeRightbarUi();
      return;
    }
    const button = event.target.closest('button[aria-label]');
    const aria = button ? (button.getAttribute('aria-label') || '') : '';
    if (/收起右侧边栏|Close right sidebar/i.test(aria)) {
      closeRightbarUi();
      return;
    }
    if (rightbarManual && /^(关闭|关闭预览|关闭图片|关闭原图预览|Close|Close preview|Close image|Close image preview)$/i.test((aria || '').trim())) {
      closeRightbarUi();
      return;
    }
    if (/打开右侧边栏|Open right sidebar/i.test(aria)) {
      rightbarSuppressedUntil = 0;
      rightbarManual = true;
      rightbarFile = { name: '', url: '', mime: '' };
      rightbarOpenedAt = Date.now();
      syncSidebar();
      return;
    }
    const target = event.target.closest('a[href],button,[role="button"]');
    if (target && !target.closest('.hp-file-action')) {
      const raw = target.getAttribute('href') || target.getAttribute('data-href')
        || target.getAttribute('data-url') || '';
      const text = (target.textContent || '').trim().split('\n')[0];
      const name = (target.getAttribute('download') || text || fileNameFromUrl(raw)).trim();
      if (name && /\.(zip|pdf|apk|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|txt|md|json|csv|mp[34]|wav)(\?|#|$)/i.test(name)) {
        if (isImageFile(name)) return;
        let url = '';
        if (/^https?:/i.test(raw)) url = raw;
        else if (raw) {
          const filePath = decodeURIComponent(raw.replace(/^file:\/\//, '').replace(/^\.?\//, ''));
          url = new URL('/__bridge/file?path=' + encodeURIComponent(filePath)
            + '&name=' + encodeURIComponent(name), location.href).href;
        }
        if (name) {
          rightbarFile = { name, url, mime: fileMime(name) };
          rightbarSuppressedUntil = 0;
          rightbarManual = true;
          rightbarOpenedAt = Date.now();
          syncSidebar();
          return;
        }
      }
    }
    if (event.target.closest('.K5rwea_cardPreview')
        || (button && /预览|Preview/i.test(aria) && !/关闭|close/i.test(aria))
        || event.target.closest('.yHUiNq_action')) {
      if (button && /图片|image/i.test(aria)) return;
      const card = event.target.closest('[data-presented-file]');
      const preview = card && card.querySelector('.K5rwea_cardPreview');
      const path = preview ? (preview.getAttribute('title') || '') : '';
      const nameNode = card && card.querySelector('.K5rwea_fileName');
      if (path && nameNode) {
        const name = (nameNode.textContent || '').trim();
        if (isImageFile(name)) return;
        const url = new URL('/__bridge/file?path=' + encodeURIComponent(path)
          + '&name=' + encodeURIComponent(name), location.href).href;
        rightbarFile = { name, url, mime: fileMime(name) };
      }
      rightbarSuppressedUntil = 0;
      rightbarManual = true;
      rightbarOpenedAt = Date.now();
      syncSidebar();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && rightbarManual) {
      closeRightbarUi();
    }
  }, true);

  function rightbarHasOpenControl() {
    return Array.from(document.querySelectorAll('button[aria-label]')).some((button) => {
      if (!/收起右侧边栏|Close right sidebar/i.test(button.getAttribute('aria-label') || '')) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function cleanupPreviewUi() {
    document.querySelectorAll('.hp-preview-actions, #hp-rightbar-toolbar, #hp-rightbar-escape')
      .forEach((node) => node.remove());
  }

  function closeRightbarUi() {
    rightbarManual = false;
    rightbarSuppressedUntil = Date.now() + 1200;
    rightbarFile = { name: '', url: '', mime: '' };
    cleanupPreviewUi();
    document.body.classList.remove('hp-rightbar-open');
    syncSidebar();
  }

  function ensureNativePreviewActions() {
    if (!rightbarManual) {
      cleanupPreviewUi();
      return;
    }
    if (!rightbarFile.name) {
      cleanupPreviewUi();
      return;
    }
    const buttons = Array.from(document.querySelectorAll('button[aria-label]'));    const close = buttons.find((button) => {
      if (!/收起右侧边栏|Close right sidebar/i.test(button.getAttribute('aria-label') || '')) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!close || !close.parentElement) return;
    const host = close.parentElement;
    let actions = host.querySelector('.hp-preview-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'hp-preview-actions';
      actions.innerHTML = `
        <button type="button" class="hp-preview-action" data-hp-preview="toggle" aria-label="下载">↓</button>`;
      actions.addEventListener('click', (event) => {
        const action = event.target.closest('[data-hp-preview]');
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        if (!rightbarFile.name) return;
        try {
          if (action.dataset.mode === 'open') {
            if (window.HarnessNative && window.HarnessNative.openFile) {
              window.HarnessNative.openFile(rightbarFile.name);
            }
          } else if (window.HarnessNative && window.HarnessNative.downloadFile) {
            window.HarnessNative.downloadFile(rightbarFile.url, rightbarFile.name, rightbarFile.mime);
            showToast('已开始下载：' + rightbarFile.name);
            setTimeout(updateNativePreviewAction, 1200);
          }
        } catch (_) {}
      });
      const external = Array.from(host.querySelectorAll('button')).find((button) =>
        /其他应用|其它应用|Open in another|other app/i.test(button.getAttribute('aria-label') || ''));
      host.insertBefore(actions, external || close);
    }
    updateNativePreviewAction();
  }

  function updateNativePreviewAction() {
    const action = document.querySelector('#hp-rightbar-toolbar [data-hp-preview="toggle"]')
      || document.querySelector('.hp-preview-actions [data-hp-preview="toggle"]');
    if (!action || !rightbarFile.name) return;
    let exists = false;
    try {
      if (window.HarnessNative && window.HarnessNative.fileState) {
        const state = JSON.parse(window.HarnessNative.fileState(rightbarFile.name) || '{}');
        exists = !!state.exists;
      }
    } catch (_) {}
    action.dataset.mode = exists ? 'open' : 'download';
    action.classList.toggle('hp-open', exists);
    action.innerHTML = exists ? openIcon : downloadIcon;
    action.setAttribute('aria-label', exists ? ('打开 ' + rightbarFile.name) : ('下载 ' + rightbarFile.name));
  }

  setInterval(() => {
    if (!rightbarManual) {
      cleanupPreviewUi();
      document.body.classList.remove('hp-rightbar-open');
      return;
    }
    // A preview that never renders must not leave an invisible full-height
    // overlay swallowing every tap.
    if (Date.now() - rightbarOpenedAt > 1200 && !rightbarHasOpenControl()) {
      closeRightbarUi();
      return;
    }
    ensureNativePreviewActions();
  }, 500);

  function syncSidebar() {
    frame = frame || document.querySelector('.mP3x-q_frame');
    if (!frame) return;
    const open = sidebarIsOpen();
    const rightOpen = rightbarIsOpen();
    document.body.classList.toggle('hp-sidebar-open', open && !rightOpen);
    document.body.classList.toggle('hp-rightbar-open', rightOpen);
    if (rightOpen) ensureNativePreviewActions();
    else cleanupPreviewUi();
    backdrop.style.display = open && !rightOpen ? 'block' : 'none';
    root.classList.toggle('hp-no-session', !document.querySelector('.an3WzG_header'));
  }

  function watchFrame() {
    const next = document.querySelector('.mP3x-q_frame');
    if (!next) return;
    if (next !== frame) {
      frame = next;
      new MutationObserver(syncSidebar).observe(frame, {
        attributes: true,
        attributeFilter: ['data-sidebar-collapsed'],
      });
    }
    syncSidebar();
  }

  /* ---------------- brand + in-header sidebar toggle ---------------- */
  const PAGE_PANEL_SELECTOR = '[data-plugin-panel="true"],[data-testid="task-manager-page"]';

  // Pages such as 插件 / 自动化任务 render their own full-width heading instead
  // of the session title row, so the drawer needs its own in-flow trigger there.
  function pageHeadingForMenu() {
    // The session title row already carries its own trigger (#hp-menu-button). If it
    // is on screen we must not also decorate some heading — that is what left a
    // stray icon floating over the header after leaving 插件 / 自动化任务.
    if (document.querySelector('.an3WzG_titleRow')) return null;
    const titles = Array.from(document.querySelectorAll('h1'));
    for (const title of titles) {
      if (!title.closest(PAGE_PANEL_SELECTOR)) continue;
      const rect = title.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && title.parentElement) {
        return { title, host: title.parentElement };
      }
    }
    for (const title of titles) {
      const rect = title.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.top > 200) continue;
      if (title.closest('.an3WzG_header')) continue;
      const host = title.parentElement;
      if (!host || host === document.body || host === document.documentElement) continue;
      const name = String(host.className || '').toLowerCase();
      if (name.includes('pageheading') || name.includes('pagehead') || name.includes('pagetitle')) {
        return { title, host };
      }
    }
    // Plugin detail views have no <h1>; their breadcrumb row is the header.
    for (const panel of Array.from(document.querySelectorAll(PAGE_PANEL_SELECTOR))) {
      const crumb = panel.querySelector('[class*="crumb" i]');
      if (!crumb) continue;
      const rect = crumb.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const host = crumb.parentElement;
      if (!host) continue;
      return { title: crumb, host };
    }
    return null;
  }

  function clearPageMenu() {
    const button = document.getElementById('hp-page-menu');
    if (button) button.remove();
    Array.from(document.querySelectorAll('.hp-page-heading')).forEach((host) => {
      host.classList.remove('hp-page-heading');
      host.style.removeProperty('padding-left');
    });
  }

  function removeFloatingMenu() {
    const floating = document.getElementById('hp-floating-menu');
    if (floating) floating.remove();
  }

  function ensurePageMenu(allowFloating) {
    const found = pageHeadingForMenu();
    if (!found) {
      clearPageMenu();
      // Without a heading there is nothing inline to click, so (and only so) the
      // floating trigger is allowed; on every other path it has to go away.
      if (allowFloating) ensureFloatingMenu();
      else removeFloatingMenu();
      return;
    }
    removeFloatingMenu();

    let button = document.getElementById('hp-page-menu');
    if (!button) {
      button = document.createElement('button');
      button.id = 'hp-page-menu';
      button.type = 'button';
      button.setAttribute('aria-label', '打开侧边栏');
      button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      button.addEventListener('click', toggleSidebar);
    }

    const { title, host } = found;
    if (button.parentElement !== host) host.insertBefore(button, host.firstElementChild);
    host.classList.add('hp-page-heading');

    if (!host.dataset.hpBasePad) {
      host.dataset.hpBasePad = String(Math.round((parseFloat(getComputedStyle(host).paddingLeft) || 0) * 10) / 10);
      host.style.setProperty('position', 'relative', 'important');
    }
    const basePad = parseFloat(host.dataset.hpBasePad) || 0;
    const wanted = String(basePad + 40) + 'px';
    if (host.style.getPropertyValue('padding-left') !== wanted) {
      host.style.setProperty('padding-left', wanted, 'important');
    }
    button.style.left = String(basePad) + 'px';
    const hostRect = host.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const top = Math.max(0, Math.round(titleRect.top - hostRect.top + (titleRect.height - 36) / 2));
    if (button.dataset.hpTop !== String(top)) {
      button.dataset.hpTop = String(top);
      button.style.top = String(top) + 'px';
    }
  }

  function ensureFloatingMenu() {
    let floating = document.getElementById('hp-floating-menu');
    const menu = document.getElementById('hp-menu-button');
    const rect = menu ? menu.getBoundingClientRect() : null;
    const menuVisible = !!rect && rect.width > 0 && rect.height > 0;
    if (menuVisible) {
      if (floating) floating.remove();
      return;
    }
    if (!floating) {
      floating = document.createElement('button');
      floating.id = 'hp-floating-menu';
      floating.type = 'button';
      floating.setAttribute('aria-label', '打开侧边栏');
      floating.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      floating.addEventListener('click', toggleSidebar);
      document.body.appendChild(floating);
    }
  }

  function ensureBrand() {
    const row = document.querySelector('.an3WzG_titleRow');
    ensurePageMenu(!row);
    if (!row) return;
    // Chat page: the row owns the trigger, so any floating leftover is wrong.
    removeFloatingMenu();
    const header = row.closest('.an3WzG_header');
    if (header) {
      const tabs = header.querySelector('.an3WzG_tabs');
      const hasTabs = !!tabs && tabs.getBoundingClientRect().height > 0;
      header.classList.toggle('hp-no-tabs', !hasTabs);
    }
    let menu = document.getElementById('hp-menu-button');
    if (!menu) {
      menu = document.createElement('button');
      menu.id = 'hp-menu-button';
      menu.type = 'button';
      menu.setAttribute('aria-label', '打开侧边栏');
      menu.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      menu.addEventListener('click', toggleSidebar);
    }
    if (menu.parentElement !== row) row.prepend(menu);
    let brand = document.getElementById('hp-brand');
    if (!brand) {
      brand = document.createElement('span');
      brand.id = 'hp-brand';
      brand.textContent = 'HARNESS';
    }
    if (brand.previousElementSibling !== menu) row.insertBefore(brand, menu.nextSibling);
  }

  /* ---------------- native downloads ----------------
   * DSH builds a temporary <a download> and clicks it. Android WebView does not
   * reliably surface that as a DownloadListener, so hand the resolved URL to
   * Android's DownloadManager before the anchor click can navigate WebView.
   */
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || '';
    const name = this.download || '';
    if (name && /^https?:/i.test(href) && window.HarnessNative &&
        typeof window.HarnessNative.downloadUrl === 'function') {
      try {
        window.HarnessNative.downloadUrl(href, name, 'application/zip');
        return;
      } catch (_) {}
    }
    return originalAnchorClick.apply(this, arguments);
  };

  /* ---------------- open-in-app: phone must only preview in HARNESS ---------------- */
  const openPattern = /用\s*.*?\s*打开|更多打开方式|显示文件位置|打开配置文件|open\s+(?:in|with)\b|more\s+ways\s+to\s+open|show\s+in\s+folders?|settings\s+file/i;
  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!target) return;
    const label = target.getAttribute('aria-label') || '';
    if (openPattern.test(label)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast('手机端仅支持在 HARNESS 内预览');
    }
  }, true);

  /* ---------------- collapse drawer after choosing a session ---------------- */
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    const action = target.closest('[aria-label*="的操作"], [aria-label*="actions for"]');
    if (action) return;
    const row = target.closest('[role="treeitem"]');
    const button = target.closest('button');
    const isNew = button && /New session|新建会话/i.test(button.getAttribute('aria-label') || '');
    if (!row && !isNew) return;
    window.setTimeout(() => {
      if (sidebarIsOpen() && !rightbarIsOpen()) toggleSidebar();
    }, 420);
  }, true);

  /* ---------------- local appearance + connection settings ---------------- */
  let toast = null;
  function showToast(message) {
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'hp-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('hp-show');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => toast.classList.remove('hp-show'), 2200);
  }

  function openSettingsFromMenu() {
    const menu = document.getElementById('hp-menu-button');
    if (menu) menu.click();
    setTimeout(() => {
      const settings = Array.from(document.querySelectorAll('button,[role="menuitem"]'))
        .find((item) => /^Settings$|^设置$/.test((item.innerText || '').trim()));
      if (settings) settings.click();
    }, 220);
  }

  function setConnectionLost(on) {
    if (!document.body) return;
    document.body.classList.toggle('hp-connection-lost', !!on);
    let banner = document.getElementById('hp-lost-banner');
    if (!on) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hp-lost-banner';
      banner.innerHTML = `<span>连接已断开，设置中可重新连接</span><button type="button">设置</button>`;
      banner.querySelector('button').addEventListener('click', openSettingsFromMenu);
      document.body.appendChild(banner);
    }
  }
  window.__hpConnectionLost = setConnectionLost;

  function injectAppearanceControl(panel) {
    const content = panel.querySelector('.AnXs9G_content');
    if (!content) return;
    const group = content.querySelector('.Iwzhua_group');
    if (!group) {
      content.querySelectorAll('.hp-appearance').forEach((node) => node.remove());
      return;
    }
    let control = document.querySelector('.hp-appearance');
    if (!control) {
      control = document.createElement('div');
      control.className = 'hp-appearance';
      control.innerHTML = `
        <div class="hp-appearance-head">
          <span>外观</span>
        </div>
        <div class="hp-theme" role="group" aria-label="手机外观">
          <button type="button" data-hp-theme="light">浅色</button>
          <button type="button" data-hp-theme="dark">深色</button>
          <button type="button" data-hp-theme="system">跟随系统</button>
        </div>`;
      control.addEventListener('click', (event) => {
        const button = event.target.closest('[data-hp-theme]');
        if (button) setTheme(button.getAttribute('data-hp-theme'));
      });
    }
    if (control.parentNode !== group.parentNode) {
      group.parentNode.insertBefore(control, group);
    }
    group.style.setProperty('display', 'none', 'important');
    applyTheme();
  }

  function localFontSize() {
    let value = 14;
    try {
      if (window.HarnessNative && typeof window.HarnessNative.getFontSize === 'function') {
        value = parseInt(window.HarnessNative.getFontSize(), 10);
      }
    } catch (_) {}
    if (!(value >= 10 && value <= 28)) {
      try { value = parseInt(localStorage.getItem('hp_font_size') || '14', 10); } catch (_) {}
    }
    if (!(value >= 10 && value <= 28)) value = 14;
    return value;
  }

  function applyLocalFontSize(value) {
    const size = Math.max(10, Math.min(28, parseInt(value, 10) || 14));
    try { localStorage.setItem('hp_font_size', String(size)); } catch (_) {}
    try {
      if (window.HarnessNative && typeof window.HarnessNative.setFontSize === 'function') {
        window.HarnessNative.setFontSize(size);
      }
    } catch (_) {}
    document.documentElement.style.setProperty('--hp-font-size', size + 'px');
    const valueNode = document.querySelector('.hp-local-font-value');
    if (valueNode) {
      if (valueNode.tagName === 'INPUT') valueNode.value = String(size);
      else valueNode.textContent = String(size);
    }
  }

  function isGeneralSettingsContent(content) {
    if (!content) return false;
    if (content.querySelector('.Iwzhua_group')) return true;
    return Array.from(content.querySelectorAll('div,span,label')).some((el) => {
      const text = (el.textContent || '').trim();
      return el.children.length === 0 && (text === '语言' || text === 'Language'
        || text === '字号大小' || text === 'Font size');
    });
  }

  function injectLocalFontSetting(panel) {
    const content = panel.querySelector('.AnXs9G_content');
    if (!content) return;
    const general = isGeneralSettingsContent(content);
    content.dataset.hpGeneral = general ? '1' : '0';
    if (!general) {
      content.querySelectorAll('.hp-local-font-row, .hp-download-row').forEach((node) => node.remove());
      return;
    }
    let nativeRow = null;
    const label = Array.from(content.querySelectorAll('div,span,label')).find((el) => {
      if (el.closest('.hp-local-font-row')) return false;
      const text = (el.textContent || '').trim();
      return el.children.length === 0 && (text === '字号大小' || text === 'Font size');
    });
    if (label) {
      nativeRow = label.closest('._7qxJPq_row')
        || label.closest('.CDP_Dq_row')
        || label.closest('[class*="row"]')
        || label.parentElement;
      if (nativeRow) {
        nativeRow.style.setProperty('display', 'none', 'important');
      }
    }
    let row = content.querySelector('.hp-local-font-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'hp-local-font-row';
      row.innerHTML = `
        <div class="hp-local-font-copy">
          <div class="hp-local-font-label"></div>
          <div class="hp-local-font-hint"></div>
        </div>
        <div class="hp-local-font-control">
          <div class="hp-font-stepper">
            <input class="hp-local-font-value" type="number" min="10" max="28" step="1" inputmode="numeric" aria-label="字号大小">
            <div class="hp-font-arrows">
              <button type="button" class="hp-font-step" data-step="1" aria-label="增大字号">▲</button>
              <button type="button" class="hp-font-step" data-step="-1" aria-label="减小字号">▼</button>
            </div>
          </div>
          <span class="hp-local-font-unit">px</span>
          <button type="button" class="hp-font-more" aria-label="更多字体设置" aria-expanded="false">⌄</button>
        </div>`;
      const input = row.querySelector('.hp-local-font-value');
      input.addEventListener('change', () => applyLocalFontSize(input.value));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyLocalFontSize(input.value);
          input.blur();
        }
      });
      row.addEventListener('click', (event) => {
        const more = event.target.closest('.hp-font-more');
        if (more) {
          const extra = content.querySelector('.hp-font-extra');
          if (extra) {
            extra.hidden = !extra.hidden;
            more.classList.toggle('hp-font-more-open', !extra.hidden);
            more.setAttribute('aria-expanded', extra.hidden ? 'false' : 'true');
          }
          return;
        }
        const button = event.target.closest('[data-step]');
        if (!button) return;
        applyLocalFontSize(localFontSize() + Number(button.getAttribute('data-step')));
      });
    }

    let extra = content.querySelector('.hp-font-extra');
    if (!extra) {
      extra = document.createElement('div');
      extra.className = 'hp-font-extra';
      extra.hidden = true;
      extra.innerHTML = `
        <div class="hp-font-extra-row">
          <div class="hp-font-extra-copy"><div class="hp-font-extra-title">正文字体</div><div class="hp-font-extra-desc">用于界面与会话正文。多个字体用逗号分隔，留空使用默认字体</div></div>
          <input class="hp-font-extra-input" data-font-field="bodyFamily" placeholder="默认">
        </div>
        <div class="hp-font-extra-row">
          <div class="hp-font-extra-copy"><div class="hp-font-extra-title">代码字体</div><div class="hp-font-extra-desc">用于代码块、行内代码与工具输出。多个字体用逗号分隔</div></div>
          <input class="hp-font-extra-input" data-font-field="codeFamily" placeholder="默认">
        </div>
        <div class="hp-font-extra-row">
          <div class="hp-font-extra-copy"><div class="hp-font-extra-title">代码字号</div><div class="hp-font-extra-desc">用于代码块、行内代码与工具输出</div></div>
          <input class="hp-font-extra-input" type="number" min="8" max="28" data-font-field="codeSize">
        </div>
        <div class="hp-font-extra-row">
          <div class="hp-font-extra-copy"><div class="hp-font-extra-title">终端字体</div><div class="hp-font-extra-desc">用于侧栏终端。多个字体用逗号分隔，留空使用默认字体</div></div>
          <input class="hp-font-extra-input" data-font-field="terminalFamily" placeholder="默认">
        </div>
        <div class="hp-font-extra-row">
          <div class="hp-font-extra-copy"><div class="hp-font-extra-title">终端字号</div><div class="hp-font-extra-desc">用于侧栏终端</div></div>
          <input class="hp-font-extra-input" type="number" min="8" max="28" data-font-field="terminalSize">
        </div>`;
      extra.querySelectorAll('[data-font-field]').forEach((input) => {
        input.addEventListener('change', () => {
          let values = {};
          try { values = JSON.parse(localStorage.getItem('hp_font_extra') || '{}'); } catch (_) {}
          values[input.getAttribute('data-font-field')] = input.value;
          try { localStorage.setItem('hp_font_extra', JSON.stringify(values)); } catch (_) {}
        });
      });
      let values = {};
      try { values = JSON.parse(localStorage.getItem('hp_font_extra') || '{}'); } catch (_) {}
      extra.querySelectorAll('[data-font-field]').forEach((input) => {
        const value = values[input.getAttribute('data-font-field')];
        if (value !== undefined) input.value = value;
        else if (input.type === 'number') input.value = input.getAttribute('data-font-field') === 'codeSize' ? '11' : '13';
      });
    }
    const english = (document.documentElement.lang || '').toLowerCase().startsWith('en');
    const labelNode = row.querySelector('.hp-local-font-label');
    if (labelNode) labelNode.textContent = english ? 'Font size' : '字号大小';
    const hintNode = row.querySelector('.hp-local-font-hint');
    if (hintNode) hintNode.textContent = english
      ? 'Affects only conversation text in this app.'
      : '仅影响 App 内的会话内容字号。';
    const valueNode = row.querySelector('.hp-local-font-value');
    if (valueNode) {
      if (valueNode.tagName === 'INPUT') valueNode.value = String(localFontSize());
      else valueNode.textContent = String(localFontSize());
    }
    const appearance = content.querySelector('.hp-appearance');
    const mount = appearance && appearance.parentNode
      ? appearance.parentNode
      : ((nativeRow && (nativeRow.closest('.RmVo8q_section') || nativeRow.closest('.AnXs9G_options'))) || content);
    if (row.parentNode !== mount || (appearance && row.previousElementSibling !== appearance)) {
      if (appearance) mount.insertBefore(row, appearance.nextSibling);
      else if (nativeRow && nativeRow.parentNode === mount) mount.insertBefore(row, nativeRow);
      else mount.insertBefore(row, mount.firstChild);
    }
    if (extra.parentNode !== mount || extra.previousElementSibling !== row) {
      mount.insertBefore(extra, row.nextSibling);
    }
    content.querySelectorAll('div[id]').forEach((panel) => {
      if (panel.closest('.hp-font-extra')) return;
      if (panel.querySelector('._7qxJPq_title')
          && /正文字体|代码字体|终端字体|代码字号|终端字号/.test(panel.textContent || '')) {
        panel.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function injectDownloadFolderSetting(panel) {
    const content = panel.querySelector('.AnXs9G_content');
    if (!content) return;
    const general = isGeneralSettingsContent(content);
    content.dataset.hpGeneral = general ? '1' : '0';
    if (!general) {
      content.querySelectorAll('.hp-download-row').forEach((node) => node.remove());
      return;
    }
    const fontRow = content.querySelector('.hp-local-font-row');
    const section = content.querySelector('.RmVo8q_section');
    if (!fontRow && !section) return;
    let row = content.querySelector('.hp-download-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'hp-download-row';
      row.innerHTML = `
        <div class="hp-download-copy">
          <div class="hp-download-label"></div>
          <div class="hp-download-hint"></div>
        </div>
        <button type="button" class="hp-download-folder" aria-label="打开下载文件夹">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>
            <path d="M3 10h18"/>
          </svg>
        </button>`;
      row.querySelector('button').addEventListener('click', () => {
        try {
          if (window.HarnessNative && window.HarnessNative.openDownloadsFolder) {
            window.HarnessNative.openDownloadsFolder();
          }
        } catch (_) {}
      });
    }
    const english = (document.documentElement.lang || '').toLowerCase().startsWith('en');
    const label = row.querySelector('.hp-download-label');
    if (label) label.textContent = english ? 'Downloaded files' : '下载的文件';
    const hint = row.querySelector('.hp-download-hint');
    if (hint) hint.textContent = english
      ? 'Open the Downloads folder in your file manager.'
      : '用文件管理器打开下载文件夹';
    const scrollBody = content.querySelector('.AnXs9G_options') || content;
    if (row.parentNode !== scrollBody || row.nextElementSibling !== null) {
      scrollBody.appendChild(row);
    }
  }


  function connectionPanelHtml() {
    return `
      <section class="hp-conn-card">
        <div class="hp-conn-card-title">Tailscale 账号</div>
        <div class="hp-conn-status" data-hp-conn-status>正在读取状态…</div>
        <div class="hp-conn-row">
          <button type="button" class="hp-btn hp-btn-primary" data-hp-conn="login">登录 Tailscale</button>
          <button type="button" class="hp-btn" data-hp-conn="logout">退出登录</button>
        </div>
      </section>
      <section class="hp-conn-card">
        <div class="hp-conn-card-title">连接设备</div>
        <div class="hp-conn-hint" data-hp-conn-hint>登录后会自动从 Tailscale 账号读取设备。</div>
        <div class="hp-conn-devices" data-hp-conn-devices></div>
        <label class="hp-conn-label" for="hp-pair-code">配对码</label>
        <input id="hp-pair-code" class="hp-input hp-code" type="text" inputmode="numeric"
               maxlength="6" autocomplete="off" placeholder="6 位数字" data-hp-conn="code">
        <button type="button" class="hp-btn hp-btn-primary hp-conn-connect" data-hp-conn="connect">保存并连接</button>
      </section>
      <section class="hp-conn-card">
        <div class="hp-conn-card-title">当前连接</div>
        <div class="hp-conn-hint" data-hp-conn-current></div>
        <div class="hp-conn-row">
          <button type="button" class="hp-btn" data-hp-conn="refresh">刷新页面</button>
          <button type="button" class="hp-btn" data-hp-conn="repair">重新配对</button>
        </div>
      </section>`;
  }

  let connectionPanel = null;
  let connectionTimer = null;
  let connectionStatus = {};
  let connectionConfig = { target: '', code: '' };
  let previousActiveNav = null;

  function nativeJson(method, fallback) {
    try {
      if (window.HarnessNative && typeof window.HarnessNative[method] === 'function') {
        return window.HarnessNative[method]() || fallback;
      }
    } catch (_) {}
    return fallback;
  }

  function openConnectionPanel() {
    const panel = document.querySelector('.AnXs9G_panel');
    if (!panel) return;
    const content = panel.querySelector('.AnXs9G_content');
    const nav = panel.querySelector('.AnXs9G_navList');
    const navButton = document.getElementById('hp-connection-nav');
    if (!content || !navButton) return;
    if (!connectionPanel) {
      connectionPanel = document.createElement('section');
      connectionPanel.id = 'hp-connection-panel';
      connectionPanel.className = 'hp-connection-panel';
      connectionPanel.innerHTML = connectionPanelHtml();
      connectionPanel.addEventListener('click', handleConnectionClick);
      content.appendChild(connectionPanel);
    }
    previousActiveNav = nav && nav.querySelector('.AnXs9G_active:not(#hp-connection-nav)');
    if (nav) nav.querySelectorAll('.AnXs9G_active').forEach((item) => item.classList.remove('AnXs9G_active'));
    navButton.classList.add('AnXs9G_active');
    const scrollToConnection = () => {
      const scroller = navButton.parentElement;
      if (!scroller) return;
      const left = navButton.offsetLeft - Math.max(0, (scroller.clientWidth - navButton.offsetWidth) / 2);
      scroller.scrollLeft = Math.max(0, left);
      try {
        navButton.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      } catch (_) {}
    };
    requestAnimationFrame(scrollToConnection);
    setTimeout(scrollToConnection, 80);
    setTimeout(scrollToConnection, 320);
    content.querySelectorAll('.AnXs9G_options').forEach((item) => item.style.setProperty('display', 'none', 'important'));
    connectionPanel.style.display = 'block';
    requestAnimationFrame(() => connectionPanel.classList.add('hp-open'));
    connectionConfig = { target: '', code: '' };
    try {
      const parsed = JSON.parse(nativeJson('connectionConfig', '{}') || '{}');
      connectionConfig.target = parsed.target || '';
      connectionConfig.code = parsed.code || '';
    } catch (_) {}
    const codeInput = connectionPanel.querySelector('[data-hp-conn="code"]');
    if (codeInput && connectionConfig.code) codeInput.value = connectionConfig.code;
    refreshConnectionPanel();
    if (connectionTimer) clearInterval(connectionTimer);
    connectionTimer = setInterval(refreshConnectionPanel, 1500);
  }

  function closeConnectionPanel(restoreActive = true) {
    if (connectionTimer) {
      clearInterval(connectionTimer);
      connectionTimer = null;
    }
    if (connectionPanel) {
      connectionPanel.classList.remove('hp-open');
      connectionPanel.style.display = 'none';
    }
    const panel = document.querySelector('.AnXs9G_panel');
    if (panel) {
      panel.querySelectorAll('.AnXs9G_options').forEach((item) => item.style.removeProperty('display'));
      const nav = panel.querySelector('.AnXs9G_navList');
      const navButton = document.getElementById('hp-connection-nav');
      if (navButton) navButton.classList.remove('AnXs9G_active');
      if (restoreActive && previousActiveNav && nav && nav.contains(previousActiveNav)) {
        previousActiveNav.classList.add('AnXs9G_active');
      }
    }
  }

  function handleConnectionClick(event) {
    const action = event.target.closest('[data-hp-conn]');
    if (!action) return;
    const value = action.getAttribute('data-hp-conn');
    if (value === 'back') {
      closeConnectionPanel(true);
      return;
    }
    if (value === 'login') {
      nativeJson('tsnetLogin');
      showToast('正在打开 Tailscale 登录页…');
      return;
    }
    if (value === 'logout') {
      nativeJson('tsnetLogout');
      return;
    }
    if (value === 'refresh') {
      if (window.HarnessNative && window.HarnessNative.refreshPage) window.HarnessNative.refreshPage();
      return;
    }
    if (value === 'repair') {
      if (window.HarnessNative && window.HarnessNative.rePair) window.HarnessNative.rePair();
      return;
    }
    if (value === 'connect') {
      const selected = connectionPanel.querySelector('input[name="hp-device"]:checked');
      const target = selected ? selected.value : '';
      const code = connectionPanel.querySelector('[data-hp-conn="code"]').value.trim();
      if (!target) {
        showToast('请选择要连接的设备');
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        showToast('请输入 6 位配对码');
        return;
      }
      if (connectionStatus.state !== 'Running') {
        showToast('请先登录 Tailscale，等状态变为“已连接”');
        return;
      }
      if (window.HarnessNative && typeof window.HarnessNative.tsnetConnect === 'function') {
        window.HarnessNative.tsnetConnect(target, code);
      }
    }
  }

  function refreshConnectionPanel() {
    if (!connectionPanel || connectionPanel.style.display === 'none') return;
    let status = {};
    try {
      status = JSON.parse(nativeJson('tsnetStatus', '{"state":"Stopped"}'));
    } catch (_) {}
    connectionStatus = status;
    const state = status.state || 'Stopped';
    const account = status.account || '';
    const statusNode = connectionPanel.querySelector('[data-hp-conn-status]');
    const hintNode = connectionPanel.querySelector('[data-hp-conn-hint]');
    if (statusNode) {
      if (state === 'Running') statusNode.textContent = (isEnglishUi() ? 'Tailscale connected' : '已连接 Tailscale') + (account ? ' · ' + account : '');
      else if (state === 'NeedsLogin' || status.authUrl) statusNode.textContent = isEnglishUi() ? 'Tailscale sign-in required' : '需要登录 Tailscale';
      else statusNode.textContent = (isEnglishUi() ? 'Tailscale status: ' : 'Tailscale 状态：') + state;
      statusNode.classList.toggle('hp-ok', state === 'Running');
    }
    const loginButton = connectionPanel.querySelector('[data-hp-conn="login"]');
    const logoutButton = connectionPanel.querySelector('[data-hp-conn="logout"]');
    if (loginButton) loginButton.style.display = state === 'Running' ? 'none' : '';
    if (logoutButton) logoutButton.style.display = state === 'Running' ? '' : 'none';
    const devicesNode = connectionPanel.querySelector('[data-hp-conn-devices]');
    if (devicesNode) {
      const devices = Array.isArray(status.devices) ? status.devices : [];
      const signature = JSON.stringify(devices);
      if (devicesNode.dataset.signature !== signature) {
        devicesNode.dataset.signature = signature;
        devicesNode.innerHTML = '';
        devices.forEach((device, index) => {
          const label = document.createElement('label');
          label.className = 'hp-device';
          const checked = connectionConfig.target === device.address || index === 0;
          label.innerHTML = `<input type="radio" name="hp-device" value="${device.address}" ${checked ? 'checked' : ''}>
            <span><b>${device.name || device.dnsName || device.address}</b><small>${device.address}${device.online ? (isEnglishUi() ? ' · Online' : ' · 在线') : (isEnglishUi() ? ' · Offline' : ' · 离线')}</small></span>`;
          devicesNode.appendChild(label);
        });
      }
      if (hintNode) hintNode.textContent = devices.length
        ? (isEnglishUi() ? `Found ${devices.length} device(s) from your Tailscale account.` : `从 Tailscale 账号读取到 ${devices.length} 台设备。`)
        : (isEnglishUi() ? 'Devices will be read from your Tailscale account after sign-in.' : '登录后会自动从 Tailscale 账号读取设备。')
    }
    const current = connectionPanel.querySelector('[data-hp-conn-current]');
    if (current) current.textContent = (isEnglishUi() ? 'Current page: ' : '当前页面：') + location.host;
    const connectButton = connectionPanel.querySelector('[data-hp-conn="connect"]');
    if (connectButton) connectButton.disabled = state !== 'Running';
  }

  function injectConnectionNav(panel) {
    const nav = panel.querySelector('.AnXs9G_navList');
    if (!nav || document.getElementById('hp-connection-nav')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'hp-connection-nav';
    button.className = 'AnXs9G_navCell hp-connection-nav';
    button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 15l6-6"/><path d="M7.5 10.5l-2 2a3.5 3.5 0 0 0 5 5l2-2"/>
      <path d="M16.5 13.5l2-2a3.5 3.5 0 0 0-5-5l-2 2"/></svg><span>连接设置</span>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openConnectionPanel();
    });
    nav.appendChild(button);
    nav.addEventListener('click', (event) => {
      if (event.target.closest('#hp-connection-nav')) return;
      if (connectionPanel && connectionPanel.style.display !== 'none') closeConnectionPanel(false);
    }, true);
  }

  function hideAddWorkspace() {
    document.querySelectorAll('button[aria-label], [role="menuitem"], [role="option"]').forEach((element) => {
      const aria = element.getAttribute('aria-label') || '';
      const text = (element.textContent || '').trim();
      if (/^添加工作区$|^Add workspace$/i.test(aria)
          || /^添加工作区$|^Add workspace$/i.test(text)) {
        const row = element.closest('[role="menuitem"],[role="option"]') || element;
        row.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function hideNativeUnsupportedSettings(panel) {
    const content = panel.querySelector('.AnXs9G_content');
    if (!content) return;
    const labels = [
      '快捷键', '编辑快捷键', 'Keyboard shortcuts', 'Keyboard shortcut', 'Edit shortcuts',
      '网页链接默认打开方式', 'Default way to open web links',
      'Default way to open links', 'Web link default open mode',
      '应用内侧边栏', 'In-app sidebar', 'Sidebar inside app',
    ];
    content.querySelectorAll('div,span,label').forEach((element) => {
      if (element.children.length !== 0) return;
      const text = (element.textContent || '').trim();
      if (!labels.some((label) => text === label || text.startsWith(label))) return;
      const row = element.closest('._7qxJPq_row')
        || element.closest('.St8tea_setting')
        || element.closest('.CDP_Dq_row')
        || element.closest('[class*="row"]')
        || element.parentElement;
      if (row && !row.classList.contains('hp-local-font-row')) {
        row.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function injectSettings(panel) {
    document.body.classList.toggle('hp-settings-open', !!panel);
    if (!panel) return;
    if (rightbarManual) {
      closeRightbarUi();
    }
    if (sidebarIsOpen() && !rightbarIsOpen()) toggleSidebar();
    hideNativeUnsupportedSettings(panel);
    injectAppearanceControl(panel);
    injectLocalFontSetting(panel);
    injectDownloadFolderSetting(panel);
    injectConnectionNav(panel);
    localizeCustomUi();
    if (connectionPanel && !panel.contains(connectionPanel)) {
      closeConnectionPanel(false);
      connectionPanel = null;
    }
  }

  function injectSettingsCard() {
    const panel = document.querySelector('.AnXs9G_panel');
    injectSettings(panel);
  }

  function injectConnectionNavForPanel() {
    const panel = document.querySelector('.AnXs9G_panel');
    if (panel) injectConnectionNav(panel);
  }

  /* ---------------- file download / open actions ---------------- */
  const fileStateCache = new Map();
  const downloadIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  const openIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="m10 14 11-11"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';

  function fileMime(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const map = {
      pdf: 'application/pdf', zip: 'application/zip', apk: 'application/vnd.android.package-archive',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
      txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav'
    };
    return map[ext] || 'application/octet-stream';
  }

  function absoluteFileUrl(raw) {
    if (!raw) return '';
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function fileNameFromUrl(url) {
    try {
      const path = new URL(url).pathname;
      return decodeURIComponent(path.substring(path.lastIndexOf('/') + 1)) || '';
    } catch (_) {
      return '';
    }
  }

  function fileInfo(old, root) {
    const attrs = ['data-download-url', 'data-url', 'data-href', 'href'];
    let raw = '';
    for (const attr of attrs) {
      raw = old.getAttribute(attr) || raw;
      if (raw) break;
    }
    if (!raw) {
      for (const attr of attrs) {
        raw = root.getAttribute(attr) || raw;
        if (raw) break;
      }
    }
    const anchors = Array.from(root.querySelectorAll('a[href]'))
      .filter((a) => /^https?:/i.test(a.href) || a.getAttribute('href')?.startsWith('/'));
    const anchor = anchors.find((a) => /\.(zip|pdf|apk|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|txt|md|json|csv|mp[34]|wav)(\?|#|$)/i.test(a.href))
      || anchors[0];
    if (!raw && anchor) raw = anchor.getAttribute('href');
    const url = absoluteFileUrl(raw);
    if (!url) return null;
    let name = old.getAttribute('download') || old.getAttribute('data-file-name') || '';
    if (!name && anchor) name = anchor.getAttribute('download') || '';
    if (!name && anchor) name = (anchor.getAttribute('title') || anchor.innerText || '').trim();
    if (!name) name = fileNameFromUrl(url);
    name = String(name).split('\n')[0].trim();
    if (!name || name.length > 180) name = fileNameFromUrl(url);
    if (!name) return null;
    return { url, name, mime: fileMime(name) };
  }

  function injectFileButton(old) {
    if (!old || old.dataset.hpFileDecorated) return;
    let root = old.parentElement;
    for (let i = 0; i < 4 && root; i++, root = root.parentElement) {
      if (root.querySelector('a[href]')) break;
    }
    root = root || old.parentElement;
    if (!root) return;
    const info = fileInfo(old, root);
    if (!info) return;
    if (root.querySelector('.hp-file-action[data-name="' + CSS.escape(info.name) + '"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hp-file-action';
    button.dataset.name = info.name;
    button.dataset.url = info.url;
    button.dataset.mime = info.mime;
    button.dataset.mode = 'download';
    button.title = '下载到本地';
    button.setAttribute('aria-label', '下载 ' + info.name);
    button.innerHTML = downloadIcon;
    old.insertAdjacentElement('afterend', button);
    old.dataset.hpFileDecorated = '1';
  }

  function decorateFileAnchors() {
    document.querySelectorAll('a[href]').forEach((anchor) => {
      if (anchor.dataset.hpFileAnchor || anchor.closest('.hp-file-action')) return;
      const raw = anchor.getAttribute('href') || '';
      const text = (anchor.textContent || '').trim();
      const name = (anchor.getAttribute('download') || text || fileNameFromUrl(raw)).split('\n')[0].trim();
      if (!name || !/\.(zip|pdf|apk|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|txt|md|json|csv|mp[34]|wav)(\?|#|$)/i.test(name)) return;
      if (!raw || /^(?:#|javascript:|mailto:)/i.test(raw)) return;
      const host = anchor.parentElement;
      if (!host || host.querySelector('.hp-file-action[data-name="' + CSS.escape(name) + '"]')) return;
      let url;
      if (/^https?:/i.test(raw)) {
        url = raw;
      } else {
        const filePath = decodeURIComponent(raw.replace(/^file:\/\//, '').replace(/^\.?\//, ''));
        url = new URL('/__bridge/file?path=' + encodeURIComponent(filePath)
          + '&name=' + encodeURIComponent(name), location.href).href;
      }
      anchor.dataset.hpFileAnchor = '1';
      anchor.classList.add('hp-file-anchor');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hp-file-action';
      button.dataset.name = name;
      button.dataset.url = url;
      button.dataset.mime = fileMime(name);
      button.dataset.mode = 'download';
      button.title = '下载到本地';
      button.setAttribute('aria-label', '下载 ' + name);
      button.innerHTML = downloadIcon;
      anchor.insertAdjacentElement('afterend', button);
    });
  }

  function decorateDeliverableCards() {
    document.querySelectorAll('[data-presented-file]').forEach((card) => {
      if (card.dataset.hpDeliverableDecorated) return;
      const preview = card.querySelector('.K5rwea_cardPreview');
      const path = preview ? (preview.getAttribute('title') || '') : '';
      if (!path) return;
      const nameNode = card.querySelector('.K5rwea_fileName');
      const name = nameNode ? (nameNode.textContent || '').trim() : fileNameFromUrl(path.replaceAll('\\', '/'));
      if (!name) return;
      const actions = card.querySelector('.K5rwea_actions') || card;
      if (actions.querySelector('.hp-file-action[data-name="' + CSS.escape(name) + '"]')) return;
      const url = new URL('/__bridge/file?path=' + encodeURIComponent(path) + '&name=' + encodeURIComponent(name), location.href).href;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hp-file-action';
      button.dataset.name = name;
      button.dataset.url = url;
      button.dataset.mime = fileMime(name);
      button.dataset.mode = 'download';
      button.title = '下载到本地';
      button.setAttribute('aria-label', '下载 ' + name);
      button.innerHTML = downloadIcon;
      actions.appendChild(button);
      card.dataset.hpDeliverableDecorated = '1';
    });
  }

  function decoratePathSpans() {
    document.querySelectorAll('.YcWBLa_paths, [class*="filePath"], [class*="FilePath"]').forEach((element) => {
      if (element.dataset.hpPathDecorated || element.closest('[data-presented-file]')) return;
      const raw = (element.textContent || '').trim();
      if (!raw || !/\.(zip|pdf|apk|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|txt|md|json|csv|mp[34]|wav)(\?|#|$)/i.test(raw)) return;
      if (!/[/\\]/.test(raw) && !/^[A-Za-z]:/.test(raw)) return;
      const name = raw.replaceAll('\\', '/').split('/').pop();
      if (!name) return;
      const filePath = raw.replace(/^file:\/\//, '').replace(/^\.?\//, '');
      const url = new URL('/__bridge/file?path=' + encodeURIComponent(filePath)
        + '&name=' + encodeURIComponent(name), location.href).href;
      element.dataset.hpPathDecorated = '1';
      element.classList.add('hp-path-file');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hp-file-action';
      button.dataset.name = name;
      button.dataset.url = url;
      button.dataset.mime = fileMime(name);
      button.dataset.mode = 'download';
      button.title = '下载到本地';
      button.setAttribute('aria-label', '下载 ' + name);
      button.innerHTML = downloadIcon;
      element.insertAdjacentElement('afterend', button);
    });
  }

  function decorateFileActions() {
    decorateDeliverableCards();
    decorateFileAnchors();
    decoratePathSpans();
    document.querySelectorAll('.mOxcpG_main, .yHUiNq_action').forEach(injectFileButton);
    refreshFileActions();
  }

  function refreshFileActions() {
    document.querySelectorAll('.hp-file-action').forEach((button) => {
      const name = button.dataset.name;
      if (!name) return;
      let state = fileStateCache.get(name);
      const now = Date.now();
      if (!state || now - state.time > 1200) {
        state = { time: now, value: {} };
        try {
          state.value = JSON.parse(window.HarnessNative.fileState(name) || '{}');
        } catch (_) {}
        fileStateCache.set(name, state);
      }
      const exists = !!state.value.exists;
      button.dataset.mode = exists ? 'open' : 'download';
      button.classList.toggle('hp-open', exists);
      button.title = exists ? '打开文件' : '下载到本地';
      button.setAttribute('aria-label', (exists ? '打开 ' : '下载 ') + name);
      button.innerHTML = exists ? openIcon : downloadIcon;
    });
  }

  // A settings nav click re-renders the section before any observer fires.
  // Clearing the marker in the capture phase hides the injected rows in the same
  // frame, so they cannot flash inside 插件 / 外观 / ….
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('.AnXs9G_navCell')) return;
    document.querySelectorAll('.AnXs9G_content').forEach((content) => {
      content.dataset.hpGeneral = '0';
    });
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.hp-file-action');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const name = button.dataset.name || '';
    if (button.dataset.mode === 'open') {
      try {
        if (window.HarnessNative && window.HarnessNative.openFile) window.HarnessNative.openFile(name);
      } catch (_) {}
      return;
    }
    const url = button.dataset.url || '';
    if (!url) {
      showToast('这个文件没有可下载的地址');
      return;
    }
    try {
      if (window.HarnessNative && window.HarnessNative.downloadFile) {
        window.HarnessNative.downloadFile(url, name, button.dataset.mime || fileMime(name));
        fileStateCache.delete(name);
        showToast('已开始下载：' + name);
        setTimeout(refreshFileActions, 1000);
      } else {
        showToast('当前版本不支持下载');
      }
    } catch (_) {
      showToast('下载失败');
    }
  });


  let ticks = 0;
  const panelObserver = new MutationObserver(() => {
    if (document.querySelector('.AnXs9G_panel')) {
      injectSettingsCard();
      panelObserver.disconnect();
    }
  });
  panelObserver.observe(document.body, { childList: true, subtree: true });

  const timer = setInterval(() => {
    ticks += 1;
    watchFrame();
    ensureBrand();
    injectSettingsCard();
    hideAddWorkspace();
    if (ticks % 2 === 0) localizeCustomUi();
    if (ticks % 4 === 0) decorateFileActions();
    if (ticks % 20 === 0) applyTheme();
  }, 400);

  /* ---------------- connection liveness ---------------- */
  let lastBeat = Date.now();
  let healthFails = 0;
  let lastReconnectRequest = 0;

  function requestReconnect(reason) {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastReconnectRequest < 5000) return;
    lastReconnectRequest = now;
    try {
      if (window.HarnessNative && window.HarnessNative.requestReconnect) {
        window.HarnessNative.requestReconnect(reason);
      }
    } catch (_) {}
  }

  setInterval(() => {
    const now = Date.now();
    if (document.hidden) {
      lastBeat = now;
      return;
    }
    if (now - lastBeat > 8000) requestReconnect('页面主线程卡顿');
    lastBeat = now;
  }, 3000);

  setInterval(async () => {
    if (document.hidden) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch('/__bridge/health', {
        cache: 'no-store',
        signal: controller.signal
      });
      const payload = response.ok ? await response.json() : null;
      if (payload && payload.ok) healthFails = 0;
      else healthFails += 1;
    } catch (_) {
      healthFails += 1;
    } finally {
      clearTimeout(timeout);
    }
    if (healthFails >= 2) {
      healthFails = 0;
      requestReconnect('桥接健康检查失败');
    }
  }, 3000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      watchFrame();
      ensureBrand();
      injectSettingsCard();
      decorateFileActions();
    }
  });

  const start = () => {
    if (!document.body) return;
    applyLocalFontSize(localFontSize());
    applyTheme();
    watchFrame();
    ensureBrand();
    injectSettingsCard();
    decorateFileActions();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
