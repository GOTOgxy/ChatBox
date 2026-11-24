let sites = [];
let hotkeys = { switcher: '', showApp: '', sites: {} };
let editingSite = null;
let pendingIcon = null;
let addPendingIcon = null;
let addHotkeyValue = '';

const IS_MAC = /mac/i.test(navigator.platform);

const PRESET_COLORS = [
  '#ffffff', '#ff5fa2', '#a855f7', '#4d6bfe', '#10a37f', '#f5a623'
];

function buildSwatches(containerId, inputId) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  container.innerHTML = '';
  for (const color of PRESET_COLORS) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('click', () => {
      input.value = color;
      markSelectedSwatch(containerId, color);
    });
    container.appendChild(swatch);
  }
  input.addEventListener('input', () => markSelectedSwatch(containerId, input.value));
}

function markSelectedSwatch(containerId, color) {
  const container = document.getElementById(containerId);
  Array.from(container.children).forEach((swatch) => {
    swatch.classList.toggle('selected', swatch.title.toLowerCase() === String(color).toLowerCase());
  });
}

buildSwatches('cfg-swatches', 'cfg-color');
buildSwatches('add-swatches', 'add-color');
buildSwatches('accent-swatches', 'accent-color');

function setAccentUi(color) {
  document.getElementById('accent-color').value = color;
  markSelectedSwatch('accent-swatches', color);
}

async function applyAccent(color) {
  const result = await window.chatbox.setAccent(color);
  setAccentUi(result.accentColor);
}

document.getElementById('home-apply').addEventListener('click', async () => {
  const value = document.getElementById('home-url').value.trim();
  const statusEl = document.getElementById('home-status');
  const result = await window.chatbox.setHome(value);
  if (result.ok) {
    statusEl.className = 'status';
    statusEl.textContent = value ? '主页已保存,点标题栏房子图标前往。' : '已恢复为当前站点首页。';
  } else {
    statusEl.className = 'status error';
    statusEl.textContent = '地址需以 http:// 或 https:// 开头。';
  }
});

document.getElementById('accent-color').addEventListener('change', (event) => applyAccent(event.target.value));
document.getElementById('accent-swatches').addEventListener('click', (event) => {
  const swatch = event.target.closest('.swatch');
  if (swatch) applyAccent(swatch.title);
});

const settingsSection = document.getElementById('settings-section');
const importSection = document.getElementById('import-section');
const siteConfigSection = document.getElementById('site-config-section');
const siteAddSection = document.getElementById('site-add-section');
const downloadsSection = document.getElementById('downloads-section');
const panelTitle = document.getElementById('panel-title');
const hotkeyStatus = document.getElementById('hotkey-status');
const importStatus = document.getElementById('import-status');
const siteHotkeysEl = document.getElementById('site-hotkeys');

function displayAccel(accelerator) {
  if (!accelerator) return '未设置';
  return accelerator
    .replace(/CommandOrControl/g, IS_MAC ? 'Cmd' : 'Ctrl')
    .replace(/Command/g, 'Cmd')
    .replace(/Control/g, 'Ctrl')
    .replace(/Super/g, IS_MAC ? 'Cmd' : 'Win');
}

function buildSiteHotkeyRows() {
  siteHotkeysEl.innerHTML = '';
  for (const site of sites) {
    const row = document.createElement('div');
    row.className = 'hotkey-row';
    row.innerHTML = `
      <span class="hotkey-label"><span class="hotkey-dot" style="background:${site.color}"></span>${site.name}</span>
      <input class="hotkey-input" data-kind="site" data-id="${site.id}" readonly />`;
    siteHotkeysEl.appendChild(row);
  }
  bindHotkeyInputs();
}

function fillHotkeyInputs() {
  document.querySelectorAll('.hotkey-input').forEach((input) => {
    const kind = input.dataset.kind;
    const value = kind === 'site' ? hotkeys.sites[input.dataset.id] : hotkeys[kind];
    input.value = displayAccel(value);
  });
}

const PUNCT_CODE_MAP = {
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Backquote: '`', IntlBackslash: '\\'
};

function recordAccelerator(event) {
  const modifiers = [];
  if (IS_MAC) {
    if (event.metaKey) modifiers.push('Command');
    if (event.ctrlKey) modifiers.push('Control');
  } else {
    if (event.ctrlKey) modifiers.push('CommandOrControl');
    if (event.metaKey) modifiers.push('Super');
  }
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0) return null;
  const code = event.code || '';
  let main = null;
  if (/^Key[A-Z]$/.test(code)) main = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) main = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) main = `num${code.slice(6)}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) main = code;
  else if (code === 'Space') main = 'Space';
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(code)) main = code;
  else if (PUNCT_CODE_MAP[code]) main = PUNCT_CODE_MAP[code];
  if (!main) return null;
  return [...modifiers, main].join('+');
}

function bindHotkeyInputs() {
  document.querySelectorAll('.hotkey-input').forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('focus', () => {
      input.classList.add('recording');
      input.dataset.original = input.value;
      input.value = '按下组合键…';
    });
    input.addEventListener('blur', () => {
      input.classList.remove('recording');
      if (input.value === '按下组合键…') input.value = input.dataset.original;
    });
    input.addEventListener('keydown', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape' || event.key === 'Escape') {
        input.value = input.dataset.original;
        input.blur();
        return;
      }
      const kind = input.dataset.kind;
      const id = input.dataset.id || null;
      if (event.code === 'Backspace' || event.code === 'Delete') {
        if (kind === 'new-site') {
          addHotkeyValue = '';
          input.value = displayAccel('');
        } else {
          await applyHotkey(kind, id, '');
        }
        input.blur();
        return;
      }
      const accelerator = recordAccelerator(event);
      if (!accelerator) return;
      if (kind === 'new-site') {
        addHotkeyValue = accelerator;
        input.value = displayAccel(accelerator);
      } else {
        await applyHotkey(kind, id, accelerator);
      }
      input.blur();
    });
  });
}

async function applyHotkey(kind, id, accelerator) {
  const result = await window.chatbox.setHotkey(kind, id, accelerator);
  if (result.hotkeys) hotkeys = result.hotkeys;
  fillHotkeyInputs();
  if (result.ok) {
    hotkeyStatus.className = 'status';
    hotkeyStatus.textContent = accelerator ? '已保存并生效。' : '已清除。';
  } else {
    hotkeyStatus.className = 'status error';
    hotkeyStatus.textContent = '注册失败:该组合键无效或已被其他软件占用,已还原。';
  }
}

document.getElementById('hotkey-clear-all').addEventListener('click', async () => {
  const result = await window.chatbox.clearHotkeys();
  if (result.hotkeys) hotkeys = result.hotkeys;
  fillHotkeyInputs();
  hotkeyStatus.className = 'status';
  hotkeyStatus.textContent = '已清空全部快捷键。';
});

window.chatbox.onPanelShow(async (data) => {
  sites = data.sites || [];
  hotkeys = data.hotkeys || { switcher: '', showApp: '', sites: {} };
  document.querySelector('.card').classList.add('ready');
  const mode = ['import', 'site-config', 'site-add', 'downloads'].includes(data.mode) ? data.mode : 'settings';
  panelTitle.textContent = {
    settings: '设置 · 全局快捷键',
    import: '导入浏览器登录态',
    'site-config': '站点配置',
    'site-add': '添加站点',
    downloads: '下载管理'
  }[mode];
  settingsSection.classList.toggle('hidden', mode !== 'settings');
  importSection.classList.toggle('hidden', mode !== 'import');
  siteConfigSection.classList.toggle('hidden', mode !== 'site-config');
  siteAddSection.classList.toggle('hidden', mode !== 'site-add');
  downloadsSection.classList.toggle('hidden', mode !== 'downloads');
  document.querySelector('.card').scrollTop = 0;
  hotkeyStatus.textContent = '';
  importStatus.textContent = '';
  if (data.site) applySiteConfig(data.site);
  buildSiteHotkeyRows();
  fillHotkeyInputs();
  window.chatbox.getSettings().then((settings) => {
    setTitlebarModeUi(settings.titlebarMode);
    setProxyUi(settings);
    setAccentUi(settings.accentColor || '#ff5fa2');
    setThemeUi(settings.theme || 'dark');
    applyTheme(settings.theme);
    setWebThemeUi(settings.webTheme || 'system');
    document.getElementById('drag-strip').checked = Boolean(settings.webDragStrip);
    const stripHeight = Number(settings.webDragStripHeight) || 16;
    document.getElementById('drag-strip-height').value = stripHeight;
    document.getElementById('drag-strip-height-value').textContent = `${stripHeight}px`;
    document.getElementById('drag-strip-height-row').classList.toggle('hidden', !settings.webDragStrip);
    document.getElementById('gpu-accel').checked = settings.gpuEnabled !== false;
    document.getElementById('home-url').value = settings.homeUrl || '';
    document.getElementById('version-text').textContent = `v${settings.version}`;
  });
  window.chatbox.getAbout().then((about) => {
    document.getElementById('auto-launch').checked = Boolean(about.autoLaunch);
    document.getElementById('user-data-path').textContent = about.userDataPath;
  });
  window.chatbox.syncStatus().then(renderSyncStatus);
  window.chatbox.downloadsList().then(renderDownloads);
  window.chatbox.extensionPath().then((extPath) => {
    document.getElementById('ext-path').textContent = extPath;
  });
  selectSettingsTab('general');
});

function setThemeUi(theme) {
  document.getElementById('theme-dark').classList.toggle('active', theme !== 'light');
  document.getElementById('theme-light').classList.toggle('active', theme === 'light');
}

for (const [buttonId, theme] of [['theme-dark', 'dark'], ['theme-light', 'light']]) {
  document.getElementById(buttonId).addEventListener('click', async () => {
    const result = await window.chatbox.setTheme(theme);
    setThemeUi(result.theme);
    applyTheme(result.theme);
  });
}

window.chatbox.onThemeUpdate(({ theme }) => {
  setThemeUi(theme);
  applyTheme(theme);
});

function setWebThemeUi(mode) {
  for (const value of ['system', 'dark', 'light']) {
    document.getElementById(`web-theme-${value}`).classList.toggle('active', (mode || 'system') === value);
  }
}

document.getElementById('drag-strip').addEventListener('change', async (event) => {
  await window.chatbox.setDragStrip(event.target.checked);
  document.getElementById('drag-strip-height-row').classList.toggle('hidden', !event.target.checked);
});

document.getElementById('drag-strip-height').addEventListener('input', (event) => {
  document.getElementById('drag-strip-height-value').textContent = `${event.target.value}px`;
});
document.getElementById('drag-strip-height').addEventListener('change', async (event) => {
  await window.chatbox.setDragStripHeight(Number(event.target.value));
});

document.getElementById('gpu-accel').addEventListener('change', async (event) => {
  await window.chatbox.setGpu(event.target.checked);
});

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function downloadStateText(item) {
  if (item.state === 'completed') return '已完成';
  if (item.state === 'cancelled') return '已取消';
  if (item.state === 'interrupted') return '已中断';
  const percent = item.total > 0 ? Math.round((item.received / item.total) * 100) : 0;
  return item.total > 0 ? `${percent}% · ${formatBytes(item.received)} / ${formatBytes(item.total)}` : formatBytes(item.received);
}

function renderDownloads(list) {
  const holder = document.getElementById('downloads-list');
  const empty = document.getElementById('downloads-empty');
  holder.innerHTML = '';
  empty.classList.toggle('hidden', list.length > 0);
  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'download-item';
    const percent = item.total > 0 ? Math.round((item.received / item.total) * 100) : 0;
    const progressBar = item.state === 'progressing'
      ? `<div class="download-progress"><div class="download-progress-fill" style="width:${percent}%"></div></div>`
      : '';
    const actions = [];
    if (item.state === 'progressing') {
      actions.push(`<button class="btn ghost dl-pause" data-id="${item.id}">暂停</button>`);
      actions.push(`<button class="btn ghost dl-cancel" data-id="${item.id}">取消</button>`);
    } else if (item.state === 'interrupted') {
      actions.push(`<button class="btn ghost dl-resume" data-id="${item.id}">继续</button>`);
    } else if (item.state === 'completed') {
      actions.push(`<button class="btn ghost dl-open" data-id="${item.id}">打开</button>`);
      actions.push(`<button class="btn ghost dl-folder" data-id="${item.id}">文件夹</button>`);
    }
    actions.push(`<button class="btn ghost dl-remove" data-id="${item.id}">移除</button>`);
    row.innerHTML = `
      <div class="download-info">
        <span class="download-name" title="${item.savePath}">${item.filename}</span>
        <span class="download-state">${downloadStateText(item)}</span>
        ${progressBar}
      </div>
      <div class="download-actions">${actions.join('')}</div>`;
    holder.appendChild(row);
  }
}

document.getElementById('downloads-list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const id = Number(button.dataset.id);
  if (button.classList.contains('dl-pause')) await window.chatbox.downloadsPause(id);
  else if (button.classList.contains('dl-resume')) await window.chatbox.downloadsResume(id);
  else if (button.classList.contains('dl-cancel')) await window.chatbox.downloadsCancel(id);
  else if (button.classList.contains('dl-open')) await window.chatbox.downloadsOpen(id);
  else if (button.classList.contains('dl-folder')) await window.chatbox.downloadsFolder(id);
  else if (button.classList.contains('dl-remove')) await window.chatbox.downloadsRemove(id);
  renderDownloads(await window.chatbox.downloadsList());
});

window.chatbox.onDownloadsUpdate(({ downloads }) => renderDownloads(downloads));

for (const mode of ['system', 'dark', 'light']) {
  document.getElementById(`web-theme-${mode}`).addEventListener('click', async () => {
    const result = await window.chatbox.setWebTheme(mode);
    setWebThemeUi(result.webTheme);
  });
}

function selectSettingsTab(name) {
  document.querySelectorAll('#settings-tabs .tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  document.querySelectorAll('#settings-section .tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.pane === name);
  });
}

document.querySelectorAll('#settings-tabs .tab-btn').forEach((button) => {
  button.addEventListener('click', () => selectSettingsTab(button.dataset.tab));
});

function applySiteConfig(site) {
  editingSite = site;
  pendingIcon = null;
  document.getElementById('cfg-name').value = site.name;
  document.getElementById('cfg-url').value = site.url;
  document.getElementById('cfg-color').value = site.color;
  markSelectedSwatch('cfg-swatches', site.color);
  const hotkeyInput = document.getElementById('cfg-hotkey');
  hotkeyInput.dataset.id = site.id;
  hotkeyInput.value = displayAccel(hotkeys.sites[site.id]);
  document.getElementById('cfg-open-in-app').checked = site.openInApp === true;
  bindHotkeyInputs();
  renderIconPreview();
  document.getElementById('cfg-status').textContent = '';
}

window.chatbox.onSiteConfig(({ site }) => applySiteConfig(site));

function renderIconPreview() {
  const preview = document.getElementById('cfg-icon-preview');
  const icon = pendingIcon !== null ? pendingIcon : (editingSite ? editingSite.icon : '');
  if (icon) {
    preview.innerHTML = `<img src="${icon}" alt="" />`;
    preview.style.background = '#ffffff';
  } else {
    preview.innerHTML = editingSite ? editingSite.letter : '?';
    preview.style.background = editingSite ? editingSite.color : '#4d6bfe';
  }
}

document.getElementById('cfg-upload').addEventListener('click', async () => {
  const result = await window.chatbox.pickIcon();
  if (result.ok) {
    pendingIcon = result.icon;
    renderIconPreview();
  } else if (result.error === 'too-large') {
    document.getElementById('cfg-status').className = 'status error';
    document.getElementById('cfg-status').textContent = '图片太大(上限 512KB)。';
  }
});

document.getElementById('cfg-clear-icon').addEventListener('click', () => {
  pendingIcon = '';
  renderIconPreview();
});

document.getElementById('cfg-fetch').addEventListener('click', async () => {
  if (!editingSite) return;
  const statusEl = document.getElementById('cfg-status');
  statusEl.className = 'status';
  statusEl.textContent = '正在拉取网站图标…';
  const result = await window.chatbox.fetchIcon(editingSite.id);
  if (result.ok) {
    pendingIcon = result.icon;
    editingSite.icon = result.icon;
    renderIconPreview();
    statusEl.textContent = '已拉取,点「保存」生效。';
  } else {
    statusEl.className = 'status error';
    statusEl.textContent = '拉取失败,可手动上传。';
  }
});

document.getElementById('cfg-save').addEventListener('click', async () => {
  if (!editingSite) return;
  const patch = {
    name: document.getElementById('cfg-name').value,
    url: document.getElementById('cfg-url').value,
    color: document.getElementById('cfg-color').value,
    openInApp: document.getElementById('cfg-open-in-app').checked
  };
  if (pendingIcon !== null) patch.icon = pendingIcon;
  const result = await window.chatbox.updateSite(editingSite.id, patch);
  const statusEl = document.getElementById('cfg-status');
  if (result.ok) {
    editingSite = result.site;
    pendingIcon = null;
    statusEl.className = 'status';
    statusEl.textContent = '已保存。';
    renderIconPreview();
  } else {
    statusEl.className = 'status error';
    statusEl.textContent = `保存失败: ${result.error}`;
  }
});

document.getElementById('cfg-disable').addEventListener('click', async () => {
  if (!editingSite) return;
  await window.chatbox.updateSite(editingSite.id, { enabled: false });
  window.chatbox.closePanel();
});

document.getElementById('cfg-delete').addEventListener('click', async () => {
  if (!editingSite) return;
  const result = await window.chatbox.deleteSite(editingSite.id);
  if (result.ok) window.chatbox.closePanel();
});

document.getElementById('add-save').addEventListener('click', async () => {
  const name = document.getElementById('add-name').value.trim();
  let url = document.getElementById('add-url').value.trim();
  const statusEl = document.getElementById('add-status');
  if (!name || !url) {
    statusEl.className = 'status error';
    statusEl.textContent = '名称和地址都要填。';
    return;
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const result = await window.chatbox.addSite({
    name,
    url,
    color: document.getElementById('add-color').value,
    icon: addPendingIcon || '',
    openInApp: document.getElementById('add-open-in-app').checked,
    hotkey: addHotkeyValue
  });
  if (result.ok) {
    statusEl.className = 'status';
    statusEl.textContent = `已添加「${result.site.name}」。`;
    document.getElementById('add-name').value = '';
    document.getElementById('add-url').value = '';
    addPendingIcon = null;
    addHotkeyValue = '';
    document.getElementById('add-hotkey').value = displayAccel('');
    document.getElementById('add-open-in-app').checked = false;
    renderAddIconPreview();
  } else {
    statusEl.className = 'status error';
    statusEl.textContent = '添加失败:请检查地址格式。';
  }
});

function setTitlebarModeUi(mode) {
  document.getElementById('mode-floating').classList.toggle('active', mode !== 'docked');
  document.getElementById('mode-docked').classList.toggle('active', mode === 'docked');
}

function renderAddIconPreview() {
  const preview = document.getElementById('add-icon-preview');
  if (addPendingIcon) {
    preview.innerHTML = `<img src="${addPendingIcon}" alt="" />`;
    preview.style.background = '#ffffff';
  } else {
    const name = document.getElementById('add-name').value.trim();
    preview.innerHTML = name ? name.charAt(0).toUpperCase() : '?';
    preview.style.background = document.getElementById('add-color').value;
  }
}

document.getElementById('add-upload').addEventListener('click', async () => {
  const result = await window.chatbox.pickIcon();
  const statusEl = document.getElementById('add-status');
  if (result.ok) {
    addPendingIcon = result.icon;
    renderAddIconPreview();
  } else if (result.error === 'too-large') {
    statusEl.className = 'status error';
    statusEl.textContent = '图片太大(上限 512KB)。';
  }
});

document.getElementById('add-clear-icon').addEventListener('click', () => {
  addPendingIcon = null;
  renderAddIconPreview();
});

document.getElementById('add-name').addEventListener('input', renderAddIconPreview);
document.getElementById('add-color').addEventListener('input', renderAddIconPreview);
bindHotkeyInputs();
renderAddIconPreview();

let proxyType = 'http';

function setProxyTypeUi(type) {
  proxyType = type === 'socks5' ? 'socks5' : 'http';
  document.getElementById('proxy-type-http').classList.toggle('active', proxyType === 'http');
  document.getElementById('proxy-type-socks5').classList.toggle('active', proxyType === 'socks5');
}

function setProxyUi(settings) {
  const mode = settings.proxyMode || 'system';
  document.getElementById('proxy-system').classList.toggle('active', mode !== 'custom');
  document.getElementById('proxy-custom').classList.toggle('active', mode === 'custom');
  document.getElementById('proxy-custom-fields').classList.toggle('hidden', mode !== 'custom');
  let type = settings.proxyType;
  let host = settings.proxyHost;
  let port = settings.proxyPort;
  if (!host && settings.proxyRules) {
    const match = /^(socks5|http)=([^:;]+):(\d+)/i.exec(settings.proxyRules.trim());
    if (match) {
      type = match[1].toLowerCase();
      host = match[2];
      port = match[3];
    }
  }
  setProxyTypeUi(type || 'http');
  document.getElementById('proxy-host').value = host || '';
  document.getElementById('proxy-port').value = port || '';
  document.getElementById('proxy-user').value = settings.proxyUser || '';
  document.getElementById('proxy-pass').value = '';
  document.getElementById('proxy-pass').placeholder = settings.proxyHasPass ? '已保存,留空则不修改' : '选填';
}

document.getElementById('proxy-type-http').addEventListener('click', () => setProxyTypeUi('http'));
document.getElementById('proxy-type-socks5').addEventListener('click', () => setProxyTypeUi('socks5'));

document.getElementById('proxy-system').addEventListener('click', async () => {
  const result = await window.chatbox.setProxyStructured({ mode: 'system' });
  const statusEl = document.getElementById('proxy-status');
  if (result.ok) {
    document.getElementById('proxy-system').classList.add('active');
    document.getElementById('proxy-custom').classList.remove('active');
    document.getElementById('proxy-custom-fields').classList.add('hidden');
    statusEl.className = 'status';
    statusEl.textContent = '已切换为系统代理,自动读取本机设置。';
  }
});

document.getElementById('proxy-custom').addEventListener('click', () => {
  document.getElementById('proxy-system').classList.remove('active');
  document.getElementById('proxy-custom').classList.add('active');
  document.getElementById('proxy-custom-fields').classList.remove('hidden');
});

document.getElementById('proxy-apply').addEventListener('click', async () => {
  const statusEl = document.getElementById('proxy-status');
  const host = document.getElementById('proxy-host').value.trim();
  const port = document.getElementById('proxy-port').value.trim();
  if (!host || !/^\d{1,5}$/.test(port)) {
    statusEl.className = 'status error';
    statusEl.textContent = '请填写服务器和有效端口(1-65535)。';
    return;
  }
  const result = await window.chatbox.setProxyStructured({
    mode: 'custom',
    type: proxyType,
    host,
    port,
    username: document.getElementById('proxy-user').value,
    password: document.getElementById('proxy-pass').value
  });
  if (result.ok) {
    document.getElementById('proxy-pass').value = '';
    document.getElementById('proxy-pass').placeholder = '已保存,留空则不修改';
    statusEl.className = 'status';
    statusEl.textContent = '代理已应用,刷新页面后生效。';
  } else {
    statusEl.className = 'status error';
    statusEl.textContent = result.error;
  }
});

for (const [buttonId, mode] of [['mode-floating', 'floating'], ['mode-docked', 'docked']]) {
  document.getElementById(buttonId).addEventListener('click', async () => {
    const result = await window.chatbox.setTitlebarMode(mode);
    if (result.ok) setTitlebarModeUi(result.titlebarMode);
  });
}

let updateInfo = null;

async function runUpdateCheck() {
  const updateStatus = document.getElementById('update-status');
  const actions = document.getElementById('update-actions');
  updateStatus.className = 'status';
  updateStatus.textContent = '检查中…';
  actions.classList.add('hidden');
  const result = await window.chatbox.checkUpdate();
  if (!result.ok) {
    updateStatus.className = 'status error';
    updateStatus.textContent = `检查失败: ${result.error}`;
    actions.classList.remove('hidden');
    document.getElementById('update-install').classList.add('hidden');
    return;
  }
  if (result.state === 'available') {
    updateInfo = result;
    updateStatus.textContent = `发现新版本 v${result.latest}(当前 v${result.current}),点「立即更新」后台下载并自动安装重启。`;
    document.getElementById('update-install').classList.remove('hidden');
    actions.classList.remove('hidden');
  } else if (result.state === 'no-release') {
    updateStatus.textContent = '暂无可用更新。';
  } else {
    updateStatus.textContent = `已是最新版本 v${result.current}。`;
  }
}

document.getElementById('update-install').addEventListener('click', async () => {
  if (!updateInfo) return;
  const updateStatus = document.getElementById('update-status');
  updateStatus.className = 'status';
  updateStatus.textContent = '下载中…';
  const result = await window.chatbox.installUpdate(updateInfo);
  if (!result.ok) {
    updateStatus.className = 'status error';
    updateStatus.textContent = `更新失败: ${result.error}。可点「在浏览器中下载」手动安装。`;
  } else if (result.state === 'installer-launched') {
    updateStatus.textContent = '安装中,应用即将自动重启…';
  }
});

document.getElementById('update-browser').addEventListener('click', () => window.chatbox.openReleasesPage());

window.chatbox.onUpdateProgress((info) => {
  const updateStatus = document.getElementById('update-status');
  if (info.phase === 'download') updateStatus.textContent = `下载中 ${info.percent}%…`;
  else if (info.phase === 'installing') updateStatus.textContent = '校验完成,启动安装器…';
});

document.getElementById('check-update').addEventListener('click', runUpdateCheck);
window.chatbox.onCheckUpdate(runUpdateCheck);

document.getElementById('auto-launch').addEventListener('change', async (event) => {
  await window.chatbox.setAutoLaunch(event.target.checked);
});

document.getElementById('open-user-data').addEventListener('click', () => window.chatbox.openUserData());

function renderSyncState(status) {
  document.getElementById('sync-enabled').checked = Boolean(status.enabled);
  const autoCheckbox = document.getElementById('sync-auto');
  autoCheckbox.checked = Boolean(status.autoSync);
  autoCheckbox.disabled = !status.enabled;
  document.getElementById('sync-upload').disabled = !status.enabled;
  document.getElementById('sync-pull').disabled = !status.enabled;
  const statusEl = document.getElementById('sync-status');
  if (status.lastError) {
    statusEl.className = 'status error';
    statusEl.textContent = `同步暂停: ${status.lastError}`;
  } else if (status.lastSyncAt) {
    statusEl.className = 'status';
    statusEl.textContent = `上次同步: ${new Date(status.lastSyncAt).toLocaleString()}`;
  } else {
    statusEl.className = 'status';
    statusEl.textContent = status.enabled ? '已启用,尚未同步。' : '未启用。填写连接配置并保存后,再打开「启用同步」。';
  }
}

function fillSyncFields(status) {
  const server = document.getElementById('sync-server');
  const user = document.getElementById('sync-user');
  const dir = document.getElementById('sync-dir');
  if (document.activeElement !== server) server.value = status.serverUrl || '';
  if (document.activeElement !== user) user.value = status.username || '';
  if (document.activeElement !== dir) dir.value = status.remoteDir || '/ChatBox/';
  document.getElementById('sync-pass').placeholder = status.hasPassword ? '已保存,留空则不修改' : '必填';
}

function renderSyncStatus(status) {
  renderSyncState(status);
  fillSyncFields(status);
}

document.getElementById('sync-save').addEventListener('click', async () => {
  const statusEl = document.getElementById('sync-status');
  statusEl.className = 'status';
  statusEl.textContent = '保存中…';
  const result = await window.chatbox.syncConfigure({
    serverUrl: document.getElementById('sync-server').value,
    username: document.getElementById('sync-user').value,
    password: document.getElementById('sync-pass').value,
    remoteDir: document.getElementById('sync-dir').value
  });
  renderSyncState(result.status);
  const passInput = document.getElementById('sync-pass');
  if (result.test && result.test.ok) {
    passInput.value = '';
    passInput.placeholder = '已保存,留空则不修改';
    statusEl.className = 'status';
    statusEl.textContent = '已保存,连接成功。可手动上传 / 拉取,或按需开启自动同步。';
  } else {
    statusEl.className = 'status error';
    statusEl.textContent = `已保存,但连接测试未通过: ${(result.test && result.test.error) || '未知错误'}。修改后重试即可,已填内容不会丢失。`;
  }
});

document.getElementById('sync-enabled').addEventListener('change', async (event) => {
  const wanted = event.target.checked;
  const result = await window.chatbox.syncSetEnabled(wanted);
  renderSyncState(result.status);
  if (!result.ok) {
    const statusEl = document.getElementById('sync-status');
    statusEl.className = 'status error';
    statusEl.textContent = result.error;
  }
});

document.getElementById('sync-auto').addEventListener('change', async (event) => {
  const wanted = event.target.checked;
  if (wanted) {
    const confirmResult = await window.chatbox.confirmDanger({
      title: '开启自动同步',
      message: '确定开启自动同步吗?',
      detail: '开启后,本机配置变更会在后台自动上传到云端(覆盖云端旧配置),并定期拉取远端更新覆盖本机。若本机是全新空配置,可能覆盖云端已有配置。建议先手动上传 / 拉取确认内容。',
      confirmLabel: '开启自动同步'
    });
    if (!confirmResult.ok) {
      event.target.checked = false;
      return;
    }
  }
  const result = await window.chatbox.syncSetAuto(wanted);
  renderSyncState(result.status);
  if (!result.ok) {
    const statusEl = document.getElementById('sync-status');
    statusEl.className = 'status error';
    statusEl.textContent = result.error;
  }
});

document.getElementById('sync-upload').addEventListener('click', async () => {
  const statusEl = document.getElementById('sync-status');
  const confirmResult = await window.chatbox.confirmDanger({
    title: '上传到云端',
    message: '确定上传本机配置到云端吗?',
    detail: '上传会用本机配置覆盖云端已有配置。若本机是全新空配置,云端原有配置将被覆盖。建议先「从云端拉取」确认内容。',
    confirmLabel: '上传到云端'
  });
  if (!confirmResult.ok) return;
  statusEl.className = 'status';
  statusEl.textContent = '上传中…';
  const result = await window.chatbox.syncUpload();
  renderSyncState(result.status);
  if (result.ok) {
    statusEl.className = 'status';
    statusEl.textContent = '已上传本机配置到云端。';
  }
});

document.getElementById('sync-pull').addEventListener('click', async () => {
  const statusEl = document.getElementById('sync-status');
  statusEl.className = 'status';
  statusEl.textContent = '拉取中…';
  const result = await window.chatbox.syncPull();
  renderSyncState(result.status);
  if (result.ok) {
    statusEl.className = 'status';
    statusEl.textContent = '已从云端拉取(仅当远端更新时覆盖,登录态不受影响)。';
  }
});

window.chatbox.onSyncStatus(renderSyncStatus);

document.getElementById('panel-close').addEventListener('click', () => window.chatbox.closePanel());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.activeElement.classList.contains('hotkey-input')) {
    window.chatbox.closePanel();
  }
});
window.addEventListener('blur', () => window.chatbox.closePanel());

document.getElementById('open-ext').addEventListener('click', async () => {
  await window.chatbox.registerHost();
  await window.chatbox.openExtensionsPage();
});
document.getElementById('copy-path').addEventListener('click', async () => {
  const extPath = await window.chatbox.extensionPath();
  await navigator.clipboard.writeText(extPath);
  importStatus.className = 'status';
  importStatus.textContent = '路径已复制。在扩展页点「加载已解压的扩展程序」选择它,或直接拖入 crx。';
});
document.getElementById('do-import').addEventListener('click', async () => {
  importStatus.className = 'status';
  importStatus.textContent = '导入中…';
  const result = await window.chatbox.runImport();
  if (result.ok) {
    const summary = Object.entries(result.imported)
      .map(([id, count]) => `${id}: ${count}`)
      .join(', ');
    const failureText = result.failures && Object.keys(result.failures).length > 0
      ? ` 部分失败: ${Object.entries(result.failures).map(([id, names]) => `${id}[${names.join('; ')}]`).join(' | ')}`
      : '';
    const storageText = result.storage && Object.keys(result.storage).length > 0
      ? ` localStorage: ${Object.entries(result.storage).map(([id, count]) => `${id}: ${count}`).join(', ')}`
      : '';
    const statusText = result.storageStatus && Object.keys(result.storageStatus).length > 0
      ? ` 采集状态: ${Object.entries(result.storageStatus).map(([origin, state]) => `${origin}=${state}`).join('; ')}`
      : '';
    importStatus.textContent = `导入完成(${summary}),页面已刷新。${storageText}${failureText}${statusText}`;
    if (failureText) importStatus.className = 'status error';
  } else if (result.reason === 'no-data') {
    importStatus.className = 'status error';
    importStatus.textContent = '还没有收到浏览器数据。请确认扩展已安装,并点一下扩展图标里的「发送登录态到 ChatAI」。';
  } else {
    importStatus.className = 'status error';
    importStatus.textContent = `导入失败: ${result.reason || result.error}`;
  }
});

window.chatbox.panelReady();
