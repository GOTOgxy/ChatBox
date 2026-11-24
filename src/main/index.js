const path = require('path');
const fs = require('fs');
const {
  app,
  BaseWindow,
  WebContentsView,
  globalShortcut,
  ipcMain,
  session,
  shell,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  screen,
  dialog
} = require('electron');
const configStore = require('./config');
const sitesStore = require('./sites-store');
const nativeHost = require('./native-host');
const mechanisms = require('./mechanisms');
const sync = require('./sync');
const updater = require('./updater');
const downloads = require('./downloads');
require('./mechanisms/icon-fetch');
require('./mechanisms/login-import');

const startHidden = process.argv.includes('--hidden');

const RENDER_PREF_FILE = 'render-mode.json';
function renderPrefPath() {
  return path.join(app.getPath('appData'), 'ChatBox', RENDER_PREF_FILE);
}
function readRenderPref() {
  try {
    return JSON.parse(fs.readFileSync(renderPrefPath(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function writeRenderPref(patch) {
  try {
    const next = { ...readRenderPref(), ...patch };
    fs.mkdirSync(path.dirname(renderPrefPath()), { recursive: true });
    fs.writeFileSync(renderPrefPath(), JSON.stringify(next));
  } catch {
  }
}
const renderPref = readRenderPref();
let forceSoftware = Boolean(renderPref.software) || process.argv.includes('--software-render');
if (forceSoftware) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

const SIDEBAR_WIDTH = 64;
const TITLEBAR_HEIGHT = 42;
const ROOT = path.join(__dirname, '..', '..');
const APP_ICON_ICO = path.join(ROOT, 'assets', 'icon.ico');
const APP_ICON_PNG = path.join(ROOT, 'assets', 'icon.png');

app.setName('ChatBox');
try {
  const appDataBase = app.getPath('appData');
  const newUserData = path.join(appDataBase, 'ChatBox');
  const oldUserData = path.join(appDataBase, 'ChatAI');
  app.setPath('userData', newUserData);
  if (fs.existsSync(oldUserData) && oldUserData !== newUserData) {
    fs.mkdirSync(newUserData, { recursive: true });
    for (const entry of fs.readdirSync(oldUserData)) {
      const from = path.join(oldUserData, entry);
      const to = path.join(newUserData, entry);
      if (fs.existsSync(to)) continue;
      fs.renameSync(from, to);
    }
  }
} catch {
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.chatbox.app');
}

let mainWindow = null;
let sidebarView = null;
let switcherWindow = null;
let panelWindow = null;
let panelView = null;
let panelReady = false;
let pendingPanelPayload = null;
let titlebarWindow = null;
let titlebarView = null;
let dockedTitlebarVisible = true;
let dockedDrag = null;
let tray = null;
let config = null;
let sites = [];
let activeSiteId = null;
let quitting = false;
const siteViews = new Map();
const recentOrder = [];

function siteById(id) {
  return sites.find((site) => site.id === id);
}

function enabledSites() {
  return sites.filter((site) => site.enabled);
}

function persistSites() {
  sitesStore.save(sites);
  sync.schedulePush();
}

function broadcastSites() {
  sendToSidebar('sites:update', { sites, active: activeSiteId, hotkeys: currentHotkeys(), opened: Array.from(siteViews.keys()) });
  if (switcherWindow && !switcherWindow.isDestroyed()) {
    const switcherView = switcherWindow.contentView.children[0];
    if (switcherView && !switcherView.webContents.isDestroyed()) {
      switcherView.webContents.send('switcher:sites', { sites: switcherData() });
    }
  }
}

function chromeUserAgent() {
  if (config.userAgent) return config.userAgent;
  const versions = process.versions;
  const chromeMajor = (versions.chrome || '130.0.0.0').split('.')[0];
  const platform =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
}

function siteSession(site) {
  return session.fromPartition(`persist:${site.id}`);
}

async function applyProxy() {
  const partitions = ['', ...sites.map((site) => `persist:${site.id}`)];
  for (const partition of partitions) {
    const ses = partition ? session.fromPartition(partition) : session.defaultSession;
    if (config.proxyMode === 'custom' && config.proxyRules) {
      await ses.setProxy({ mode: 'fixed_servers', proxyRules: effectiveProxyRules() });
    } else if (config.proxyMode === 'direct') {
      await ses.setProxy({ mode: 'direct' });
    } else {
      await ses.setProxy({ mode: 'system' });
    }
  }
}

function proxyPassword() {
  if (!config.proxyPassEnc) return '';
  try {
    return safeStorage.decryptString(Buffer.from(config.proxyPassEnc, 'base64'));
  } catch {
    return '';
  }
}

function buildProxyRules(type, host, port) {
  if (type === 'socks5') return `socks5=${host}:${port}`;
  return `http=${host}:${port};https=${host}:${port}`;
}

function effectiveProxyRules() {
  const rules = String(config.proxyRules || '').trim();
  const match = /^http=([^:;]+):(\d+)$/i.exec(rules);
  if (match) return `http=${match[1]}:${match[2]};https=${match[1]}:${match[2]}`;
  return rules;
}

function parseProxyRules(rules) {
  const match = /^(socks5|http)=([^:;]+):(\d+)/i.exec(String(rules || '').trim());
  if (!match) return { type: 'http', host: '', port: '' };
  return { type: match[1].toLowerCase(), host: match[2], port: match[3] };
}

function attachProxyAuth() {
  const handler = (event, webContents, request, authInfo, callback) => {
    if (authInfo.isProxy && config.proxyMode === 'custom' && config.proxyUser) {
      event.preventDefault();
      callback(config.proxyUser, proxyPassword());
    }
  };
  const sessions = [session.defaultSession, ...sites.map((site) => session.fromPartition(`persist:${site.id}`))];
  for (const ses of sessions) {
    if (ses.__chatboxProxyAuth) ses.removeListener('login', ses.__chatboxProxyAuth);
    ses.__chatboxProxyAuth = handler;
    ses.on('login', handler);
  }
}

const DRAG_STRIP_ID = '__chatbox_drag_strip__';

function dragStripInjectCode() {
  const stripHeight = Math.max(4, Math.min(60, Number(config.webDragStripHeight) || 16));
  return `(() => {
    const existing = document.getElementById('${DRAG_STRIP_ID}');
    if (existing) existing.remove();
    if (!${config.webDragStrip ? 'true' : 'false'}) return;
    const strip = document.createElement('div');
    strip.id = '${DRAG_STRIP_ID}';
    strip.style.cssText = 'position:fixed;top:0;left:0;right:0;height:${stripHeight}px;z-index:2147483647;-webkit-app-region:drag;cursor:grab;background:transparent;';
    document.documentElement.appendChild(strip);
  })()`;
}

function applyDragStripToView(view) {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.executeJavaScript(dragStripInjectCode(), true).catch(() => {});
}

function applyDragStripToAll() {
  for (const view of siteViews.values()) applyDragStripToView(view);
}

function createSiteView(site) {
  const partition = siteSession(site);
  partition.setUserAgent(chromeUserAgent());
  if (config.proxyMode === 'custom' && config.proxyRules) {
    partition.setProxy({ mode: 'fixed_servers', proxyRules: effectiveProxyRules() }).catch(() => {});
  } else if (config.proxyMode === 'direct') {
    partition.setProxy({ mode: 'direct' }).catch(() => {});
  }
  attachProxyAuth();
  downloads.attach(partition);
  const view = new WebContentsView({
    webPreferences: {
      partition: `persist:${site.id}`,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  view.setBackgroundColor('#ffffff');
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      const current = siteById(site.id);
      if (current && current.openInApp) {
        view.webContents.loadURL(url);
      } else {
        shell.openExternal(url);
      }
    }
    return { action: 'deny' };
  });
  view.webContents.on('did-finish-load', () => {
    const current = siteById(site.id);
    if (current && !current.icon) tryFetchFavicon(site.id);
    applyDragStripToView(view);
  });
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    setTimeout(() => {
      if (!view.webContents.isDestroyed() && view.webContents.getURL() === validatedURL) {
        view.webContents.reload();
      }
    }, 1500);
  });
  view.webContents.on('page-title-updated', (_event, title) => {
    const match = title.match(/^\((\d+)\)/);
    const unread = match ? Number(match[1]) : 0;
    sendToSidebar('site:unread', { id: site.id, unread, title });
    if (switcherWindow && !switcherWindow.isDestroyed()) {
      const switcherView = switcherWindow.contentView.children[0];
      if (switcherView && !switcherView.webContents.isDestroyed()) {
        switcherView.webContents.send('site:unread', { id: site.id, unread });
      }
    }
  });
  const syncUrl = () => {
    if (titlebarWindow && !titlebarWindow.isDestroyed() && titlebarWindow.isVisible() && activeSiteId === site.id) {
      titlebarView.webContents.send('titlebar:url', { url: view.webContents.getURL() });
    }
  };
  view.webContents.on('did-navigate', syncUrl);
  view.webContents.on('did-navigate-in-page', syncUrl);
  view.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit' && !view.webContents.isDestroyed()) {
      setTimeout(() => {
        if (!view.webContents.isDestroyed()) view.webContents.reload();
      }, 1000);
    }
  });
  view.webContents.loadURL(site.url);
  siteViews.set(site.id, view);
  return view;
}

async function tryFetchFavicon(id) {
  const site = siteById(id);
  if (!site) return { ok: false };
  if (!siteViews.has(id)) createSiteView(site);
  const result = await mechanisms.run('icon-fetch', {
    site,
    getView: (siteId) => siteViews.get(siteId)
  });
  if (result.ok && result.icon) {
    site.icon = result.icon;
    persistSites();
    broadcastSites();
  }
  return result;
}

function sendToSidebar(channel, payload) {
  if (sidebarView && !sidebarView.webContents.isDestroyed()) {
    sidebarView.webContents.send(channel, payload);
  }
}

function themeBg() {
  return config.theme === 'light' ? '#f2f3f6' : '#17181c';
}

function applyWebTheme() {
  const mode = config.webTheme;
  nativeTheme.themeSource = mode === 'dark' || mode === 'light' ? mode : 'system';
}

function broadcastTheme() {
  const theme = config.theme || 'dark';
  applyWebTheme();
  sendToSidebar('theme:update', { theme });
  if (panelView && !panelView.webContents.isDestroyed()) panelView.webContents.send('theme:update', { theme });
  if (titlebarView && !titlebarView.webContents.isDestroyed()) titlebarView.webContents.send('theme:update', { theme });
  if (switcherWindow && !switcherWindow.isDestroyed()) {
    const view = switcherWindow.contentView.children[0];
    if (view && !view.webContents.isDestroyed()) view.webContents.send('theme:update', { theme });
  }
  if (sidebarView && !sidebarView.webContents.isDestroyed()) sidebarView.setBackgroundColor(themeBg());
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(themeBg());
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getContentBounds();
  const width = bounds.width;
  const height = bounds.height;
  const dockedShown = config.titlebarMode === 'docked' && dockedTitlebarVisible;
  const topOffset = dockedShown ? TITLEBAR_HEIGHT : 0;
  setViewBoundsNudged(sidebarView, { x: 0, y: topOffset, width: SIDEBAR_WIDTH, height: Math.max(0, height - topOffset) });
  const activeView = siteViews.get(activeSiteId);
  if (activeView) {
    setViewBoundsNudged(activeView, { x: SIDEBAR_WIDTH, y: topOffset, width: Math.max(0, width - SIDEBAR_WIDTH), height: Math.max(0, height - topOffset) });
  }
  if (dockedShown && titlebarView && !titlebarView.webContents.isDestroyed()) {
    setViewBoundsNudged(titlebarView, { x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
  }
}

function setViewBoundsNudged(view, bounds) {
  if (!view || view.webContents.isDestroyed()) return;
  const current = view.getBounds();
  const sameBounds = current.x === bounds.x && current.y === bounds.y && current.width === bounds.width && current.height === bounds.height;
  if (sameBounds && view.__chatboxPainted && !view.__chatboxForcePaint) {
    return;
  }
  view.__chatboxForcePaint = false;
  view.__chatboxPainted = true;
  if (sameBounds) {
    view.setBounds({ ...bounds, height: bounds.height + 1 });
    setTimeout(() => {
      if (!view.webContents.isDestroyed()) view.setBounds(bounds);
    }, 30);
  } else {
    view.setBounds(bounds);
  }
}

function forceRepaintViews() {
  if (sidebarView && !sidebarView.webContents.isDestroyed()) sidebarView.__chatboxForcePaint = true;
  const activeView = siteViews.get(activeSiteId);
  if (activeView && !activeView.webContents.isDestroyed()) activeView.__chatboxForcePaint = true;
  if (titlebarView && !titlebarView.webContents.isDestroyed()) titlebarView.__chatboxForcePaint = true;
  layoutViews();
}

function activateSite(id, { focus = true } = {}) {
  const site = siteById(id);
  if (!site || !site.enabled) return;
  if (!siteViews.has(id)) createSiteView(site);
  if (activeSiteId && activeSiteId !== id) {
    const previous = siteViews.get(activeSiteId);
    if (previous) mainWindow.contentView.removeChildView(previous);
  }
  activeSiteId = id;
  const view = siteViews.get(id);
  mainWindow.contentView.addChildView(view);
  mainWindow.contentView.addChildView(sidebarView);
  layoutViews();
  if (focus) view.webContents.focus();
  const index = recentOrder.indexOf(id);
  if (index !== -1) recentOrder.splice(index, 1);
  recentOrder.unshift(id);
  config.lastActive = id;
  configStore.save(config);
  sendToSidebar('site:active', { id });
  sendToSidebar('hotkeys:update', currentHotkeys());
  broadcastOpened();
  if (config.titlebarMode === 'docked') pushTitlebarState();
  if (switcherWindow && !switcherWindow.isDestroyed()) {
    const switcherView = switcherWindow.contentView.children[0];
    if (switcherView && !switcherView.webContents.isDestroyed()) {
      switcherView.webContents.send('site:active', { id });
    }
  }
}

function broadcastOpened() {
  sendToSidebar('sites:opened', { opened: Array.from(siteViews.keys()) });
}

function closeSiteView(id) {
  const view = siteViews.get(id);
  if (!view) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(view);
  }
  siteViews.delete(id);
  view.webContents.close();
  if (activeSiteId === id) {
    activeSiteId = null;
    config.lastActive = '';
    configStore.save(config);
    sendToSidebar('site:active', { id: null });
    if (config.titlebarMode === 'docked') pushTitlebarState();
  }
  broadcastOpened();
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  nudgeMainWindow();
  setTimeout(forceRepaintViews, 150);
}

function nudgeMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ ...bounds, height: bounds.height + 1 });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
      const current = mainWindow.getBounds();
      if (current.height === bounds.height + 1) mainWindow.setBounds(bounds);
    }
  }, 60);
}

function toggleMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }
  showMainWindow();
}

function defaultBrowserScheme() {
  try {
    const { execFileSync } = require('child_process');
    if (process.platform === 'win32') {
      const progId = execFileSync('reg', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
        '/v', 'ProgId'
      ], { encoding: 'utf8' });
      if (/edge/i.test(progId)) return 'microsoft-edge';
      return 'chrome';
    }
    if (process.platform === 'darwin') {
      const plist = execFileSync('defaults', [
        'read',
        'com.apple.LaunchServices/com.apple.launchservices.secure',
        'LSHandlers'
      ], { encoding: 'utf8' });
      const httpsBlock = plist.split('}').find((block) => /LSHandlerURLScheme\s*=\s*https/.test(block)) || '';
      if (/edge/i.test(httpsBlock)) return 'microsoft-edge';
      return 'chrome';
    }
    const desktop = execFileSync('xdg-settings', ['get', 'default-urlScheme-handler', 'https'], { encoding: 'utf8' });
    if (/edge/i.test(desktop)) return 'microsoft-edge';
    return 'chrome';
  } catch {
    return 'chrome';
  }
}

function createMainWindow() {
  const savedBounds = config.windowBounds || {};
  mainWindow = new BaseWindow({
    width: savedBounds.width || 1200,
    height: savedBounds.height || 800,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 640,
    minHeight: 480,
    title: 'ChatBox',
    backgroundColor: '#17181c',
    icon: process.platform === 'win32' ? APP_ICON_ICO : APP_ICON_PNG,
    frame: false,
    movable: true,
    show: false
  });

  sidebarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'sidebar.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  sidebarView.setBackgroundColor(themeBg());
  mainWindow.contentView.addChildView(sidebarView);
  sidebarView.webContents.loadFile(path.join(ROOT, 'src', 'renderer', 'sidebar', 'index.html'));

  const enabled = enabledSites();
  const initial = enabled.some((site) => site.id === config.lastActive)
    ? config.lastActive
    : null;
  if (initial) activateSite(initial, { focus: false });
  for (const site of enabled) {
    if (!recentOrder.includes(site.id)) recentOrder.push(site.id);
  }

  attachTitlebarEvents();
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
    config.windowBounds = mainWindow.getBounds();
    configStore.save(config);
  };
  let boundsTimer = null;
  const scheduleBoundsPersist = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(persistBounds, 500);
  };
  mainWindow.on('resize', scheduleBoundsPersist);
  mainWindow.on('move', scheduleBoundsPersist);
  const refreshPaint = () => {
    forceRepaintViews();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(themeBg());
    if (sidebarView && !sidebarView.webContents.isDestroyed()) sidebarView.setBackgroundColor(themeBg());
  };
  mainWindow.on('show', refreshPaint);
  mainWindow.on('restore', refreshPaint);
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  sidebarView.webContents.once('did-finish-load', () => {
    if (!startHidden) {
      mainWindow.show();
      nudgeMainWindow();
      setTimeout(() => { nudgeMainWindow(); forceRepaintViews(); }, 300);
      setTimeout(() => { nudgeMainWindow(); forceRepaintViews(); }, 1000);
    }
  });
  sidebarView.webContents.once('did-finish-load', () => {
    sendToSidebar('init', {
      sites,
      active: activeSiteId,
      extensionId: safeExtensionId(),
      hotkeys: currentHotkeys(),
      titlebarMode: config.titlebarMode,
      accentColor: config.accentColor,
      theme: config.theme || 'dark',
      opened: Array.from(siteViews.keys())
    });
  });
}

function currentHotkeys() {
  return {
    switcher: config.switcherHotkey,
    showApp: config.showAppHotkey,
    sites: { ...config.siteHotkeys }
  };
}

function safeExtensionId() {
  try {
    return nativeHost.extensionId();
  } catch {
    return '';
  }
}

function switcherData() {
  return recentOrder.map((id) => siteById(id)).filter((site) => site && site.enabled);
}

function createSwitcherWindow() {
  switcherWindow = new BaseWindow({
    width: 560,
    height: 150,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    transparent: true
  });
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'switcher.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  view.setBackgroundColor('#00000000');
  switcherWindow.contentView.addChildView(view);
  const bounds = switcherWindow.getContentBounds();
  view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  view.webContents.loadFile(path.join(ROOT, 'src', 'renderer', 'switcher', 'index.html'));
  view.webContents.on('blur', hideSwitcher);
  switcherWindow.on('blur', hideSwitcher);
}

function toggleSwitcher() {
  if (!switcherWindow) createSwitcherWindow();
  if (switcherWindow.isVisible()) {
    hideSwitcher();
    return;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const bounds = switcherWindow.getBounds();
  switcherWindow.setPosition(
    Math.round(area.x + (area.width - bounds.width) / 2),
    Math.round(area.y + area.height * 0.32)
  );
  const view = switcherWindow.contentView.children[0];
  view.webContents.send('switcher:show', { sites: switcherData(), active: activeSiteId, theme: config.theme || 'dark' });
  switcherWindow.show();
  switcherWindow.focus();
  view.webContents.focus();
}

function hideSwitcher() {
  if (switcherWindow && !switcherWindow.isDestroyed() && switcherWindow.isVisible()) {
    switcherWindow.hide();
  }
}

function pickFromSwitcher(id) {
  hideSwitcher();
  showMainWindow();
  activateSite(id);
}

function ensurePanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) return;
  panelReady = false;
  panelWindow = new BaseWindow({
    width: 540,
    height: 580,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    transparent: true,
    parent: mainWindow
  });
  panelView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'panel.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  panelView.setBackgroundColor('#00000000');
  panelWindow.contentView.addChildView(panelView);
  const bounds = panelWindow.getContentBounds();
  panelView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  panelView.webContents.loadFile(path.join(ROOT, 'src', 'renderer', 'panel', 'index.html'));
  panelWindow.on('blur', hidePanel);
  panelWindow.on('closed', () => {
    panelWindow = null;
    panelView = null;
    panelReady = false;
    pendingPanelPayload = null;
  });
}

function flushPanelPayload() {
  if (!pendingPanelPayload || !panelView || panelView.webContents.isDestroyed()) return;
  panelView.webContents.send('panel:show', pendingPanelPayload);
  pendingPanelPayload = null;
}

function openPanel(mode, extra = {}) {
  ensurePanelWindow();
  const targetSize = mode === 'downloads' ? { width: 560, height: 520 } : { width: 540, height: 580 };
  const currentSize = panelWindow.getContentBounds();
  if (currentSize.width !== targetSize.width || currentSize.height !== targetSize.height) {
    panelWindow.setContentSize(targetSize.width, targetSize.height);
    panelView.setBounds({ x: 0, y: 0, width: targetSize.width, height: targetSize.height });
  }
  const mainBounds = mainWindow.getBounds();
  const panelBounds = panelWindow.getBounds();
  const display = screen.getDisplayMatching(mainBounds);
  const area = display.workArea;
  let x = mainBounds.x + SIDEBAR_WIDTH + 10;
  let y = mainBounds.y + mainBounds.height - panelBounds.height - 16;
  x = Math.min(Math.max(x, area.x), area.x + area.width - panelBounds.width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - panelBounds.height);
  panelWindow.setPosition(Math.round(x), Math.round(y));
  pendingPanelPayload = {
    mode,
    sites: enabledSites(),
    hotkeys: currentHotkeys(),
    allSites: sites,
    ...extra
  };
  if (panelReady) flushPanelPayload();
  panelWindow.show();
  panelWindow.focus();
  panelView.webContents.focus();
}

function hidePanel() {
  if (panelWindow && !panelWindow.isDestroyed() && panelWindow.isVisible()) {
    panelWindow.hide();
  }
}

function ensureTitlebarWindow() {
  if (!titlebarView || titlebarView.webContents.isDestroyed()) {
    titlebarView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'titlebar.js'),
        contextIsolation: true,
        sandbox: false
      }
    });
    titlebarView.setBackgroundColor('#00000000');
    titlebarView.webContents.loadFile(path.join(ROOT, 'src', 'renderer', 'titlebar', 'index.html'));
    titlebarView.webContents.on('did-finish-load', () => pushTitlebarState());
  }
  if (config.titlebarMode === 'docked') {
    if (titlebarWindow && !titlebarWindow.isDestroyed()) {
      titlebarWindow.contentView.removeChildView(titlebarView);
      titlebarWindow.hide();
    }
    if (!mainWindow.contentView.children.includes(titlebarView)) {
      mainWindow.contentView.addChildView(titlebarView);
    }
    layoutViews();
    pushTitlebarState();
    return;
  }
  if (mainWindow.contentView.children.includes(titlebarView)) {
    mainWindow.contentView.removeChildView(titlebarView);
  }
  if (!titlebarWindow || titlebarWindow.isDestroyed()) {
    titlebarWindow = new BaseWindow({
      width: 760,
      height: 56,
      frame: false,
      resizable: true,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      transparent: true,
      parent: mainWindow
    });
    titlebarWindow.on('closed', () => {
      titlebarWindow = null;
    });
    titlebarWindow.on('blur', hideTitlebar);
    titlebarWindow.on('resize', () => {
      if (!titlebarWindow || titlebarWindow.isDestroyed() || !titlebarView) return;
      const bounds = titlebarWindow.getContentBounds();
      titlebarView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    });
  }
  if (!titlebarWindow.contentView.children.includes(titlebarView)) {
    titlebarWindow.contentView.addChildView(titlebarView);
  }
  titlebarWindow.hide();
}

function attachTitlebarEvents() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.on('resize', () => {
    layoutViews();
  });
  mainWindow.on('hide', () => {
    if (titlebarWindow && !titlebarWindow.isDestroyed()) titlebarWindow.hide();
  });
}

function pushTitlebarState() {
  if (!titlebarView || titlebarView.webContents.isDestroyed()) return;
  const activeView = siteViews.get(activeSiteId);
  titlebarView.webContents.send('titlebar:show', {
    platform: process.platform,
    mode: config.titlebarMode,
    theme: config.theme || 'dark',
    site: siteById(activeSiteId),
    url: activeView ? activeView.webContents.getURL() : ''
  });
}

function toggleTitlebar() {
  if (config.titlebarMode === 'docked') {
    ensureTitlebarWindow();
    if (dockedTitlebarVisible) {
      dockedTitlebarVisible = false;
      if (mainWindow.contentView.children.includes(titlebarView)) {
        mainWindow.contentView.removeChildView(titlebarView);
      }
    } else {
      dockedTitlebarVisible = true;
      if (!mainWindow.contentView.children.includes(titlebarView)) {
        mainWindow.contentView.addChildView(titlebarView);
      }
      pushTitlebarState();
    }
    layoutViews();
    return;
  }
  ensureTitlebarWindow();
  if (titlebarWindow.isVisible()) {
    hideTitlebar();
    return;
  }
  const mainBounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(mainBounds);
  const area = display.workArea;
  const width = Math.min(760, Math.max(480, mainBounds.width - 24));
  const height = 56;
  titlebarWindow.setSize(width, height);
  titlebarView.setBounds({ x: 0, y: 0, width, height });
  let x = mainBounds.x + Math.round((mainBounds.width - width) / 2);
  let y = mainBounds.y + 10;
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  titlebarWindow.setPosition(x, y);
  pushTitlebarState();
  titlebarWindow.show();
  titlebarWindow.focus();
  titlebarView.webContents.focus();
}

function hideTitlebar() {
  if (config.titlebarMode === 'docked') return;
  if (titlebarWindow && !titlebarWindow.isDestroyed() && titlebarWindow.isVisible()) {
    titlebarWindow.hide();
  }
}

function setTitlebarMode(mode) {
  config.titlebarMode = mode === 'docked' ? 'docked' : 'floating';
  configStore.save(config);
  sync.schedulePush();
  if (config.titlebarMode === 'docked') dockedTitlebarVisible = true;
  ensureTitlebarWindow();
  layoutViews();
  return { ok: true, titlebarMode: config.titlebarMode };
}

function stopDockedDrag() {
  if (dockedDrag) {
    clearInterval(dockedDrag.timer);
    dockedDrag = null;
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const failed = [];
  const tryRegister = (accelerator, handler, label) => {
    if (!accelerator) return;
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, handler);
    } catch {
      ok = false;
    }
    if (!ok) failed.push(label);
  };
  tryRegister(config.switcherHotkey, toggleSwitcher, 'switcher');
  tryRegister(config.showAppHotkey, toggleMainWindow, 'showApp');
  for (const site of enabledSites()) {
    tryRegister(config.siteHotkeys[site.id], () => {
      showMainWindow();
      activateSite(site.id);
    }, site.id);
  }
  return failed;
}

function setHotkey(kind, id, accelerator) {
  const previous =
    kind === 'switcher' ? config.switcherHotkey
    : kind === 'showApp' ? config.showAppHotkey
    : config.siteHotkeys[id];
  if (kind === 'switcher') config.switcherHotkey = accelerator;
  else if (kind === 'showApp') config.showAppHotkey = accelerator;
  else if (kind === 'site' && siteById(id)) config.siteHotkeys[id] = accelerator;
  else return { ok: false, error: 'unknown target' };
  const failed = registerShortcuts();
  const label = kind === 'site' ? id : kind;
  if (failed.includes(label)) {
    if (kind === 'switcher') config.switcherHotkey = previous;
    else if (kind === 'showApp') config.showAppHotkey = previous;
    else config.siteHotkeys[id] = previous;
    registerShortcuts();
    return { ok: false, error: 'register-failed', hotkeys: currentHotkeys() };
  }
  configStore.save(config);
  rebuildTrayMenu();
  sendToSidebar('hotkeys:update', currentHotkeys());
  sync.schedulePush();
  return { ok: true, hotkeys: currentHotkeys(), conflicts: failed };
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  const icon2x = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray@2x.png'));
  if (!icon2x.isEmpty()) icon.addRepresentation({ scaleFactor: 2, buffer: icon2x.toPNG() });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('ChatBox');
  rebuildTrayMenu();
  tray.on('click', showMainWindow);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: showMainWindow
    },
    {
      label: '设置',
      click: () => {
        showMainWindow();
        openPanel('settings');
      }
    },
    {
      label: '检查更新',
      click: () => {
        showMainWindow();
        openPanel('settings');
        if (panelView && !panelView.webContents.isDestroyed()) {
          panelView.webContents.send('panel:check-update');
        }
      }
    },
    {
      label: forceSoftware ? '恢复硬件加速（重启）' : '兼容渲染模式（黑屏修复，重启）',
      click: () => {
        writeRenderPref({ software: !forceSoftware });
        app.relaunch();
        quitting = true;
        app.quit();
      }
    },
    { type: 'separator' },
    {
      label: '重启',
      click: () => {
        app.relaunch();
        quitting = true;
        app.quit();
      }
    },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

async function importCookies() {
  const importPath = path.join(app.getPath('userData'), 'cookie-import.json');
  if (!fs.existsSync(importPath)) {
    return { ok: false, reason: 'no-data' };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(importPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'bad-data' };
  }
  const result = await mechanisms.run('login-import', {
    data,
    sites: enabledSites(),
    getSession: siteSession,
    getView: (id) => siteViews.get(id),
    ensureView: (site) => {
      if (!siteViews.has(site.id)) createSiteView(site);
      const view = siteViews.get(site.id);
      if (view && !view.webContents.isDestroyed() && !view.webContents.getURL()) {
        view.webContents.loadURL(site.url);
      }
      return view;
    },
    setUserAgent: (userAgent) => {
      config.userAgent = userAgent;
      configStore.save(config);
      for (const site of enabledSites()) siteSession(site).setUserAgent(userAgent);
    }
  });
  try {
    fs.unlinkSync(importPath);
  } catch {
  }
  return result;
}

function setupIpc() {
  ipcMain.on('site:activate', (_event, id) => activateSite(id));
  ipcMain.on('switcher:pick', (_event, id) => pickFromSwitcher(id));
  ipcMain.on('switcher:hide', hideSwitcher);
  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow && mainWindow.close());
  ipcMain.on('panel:open', (_event, mode) => openPanel(mode));
  ipcMain.handle('settings:set-drag-strip', (_event, enabled) => {
    config.webDragStrip = Boolean(enabled);
    configStore.save(config);
    sync.schedulePush();
    applyDragStripToAll();
    return { ok: true, webDragStrip: config.webDragStrip };
  });
  ipcMain.handle('settings:set-drag-strip-height', (_event, height) => {
    config.webDragStripHeight = Math.max(4, Math.min(60, Number(height) || 16));
    configStore.save(config);
    sync.schedulePush();
    applyDragStripToAll();
    return { ok: true, webDragStripHeight: config.webDragStripHeight };
  });
  ipcMain.handle('settings:set-gpu', (_event, enabled) => {
    const software = !enabled;
    writeRenderPref({ software });
    forceSoftware = software;
    rebuildTrayMenu();
    app.relaunch();
    quitting = true;
    setTimeout(() => app.quit(), 200);
    return { ok: true, gpuEnabled: enabled };
  });
  ipcMain.handle('downloads:list', () => downloads.list());
  ipcMain.handle('downloads:pause', (_event, id) => { downloads.pause(id); return { ok: true }; });
  ipcMain.handle('downloads:resume', (_event, id) => { downloads.resume(id); return { ok: true }; });
  ipcMain.handle('downloads:cancel', (_event, id) => { downloads.cancel(id); return { ok: true }; });
  ipcMain.handle('downloads:open', (_event, id) => { downloads.openFile(id); return { ok: true }; });
  ipcMain.handle('downloads:folder', (_event, id) => { downloads.showInFolder(id); return { ok: true }; });
  ipcMain.handle('downloads:remove', (_event, id) => { downloads.remove(id); return { ok: true }; });
  ipcMain.on('panel:close', hidePanel);
  ipcMain.on('panel:ready', () => {
    panelReady = true;
    flushPanelPayload();
  });
  ipcMain.on('titlebar:toggle', toggleTitlebar);
  ipcMain.on('titlebar:close', hideTitlebar);
  ipcMain.on('titlebar:docked-drag-start', (_event, { screenX, screenY }) => {
    if (!mainWindow || mainWindow.isDestroyed() || dockedDrag) return;
    if (mainWindow.isMaximized()) return;
    const bounds = mainWindow.getBounds();
    const scaleFactor = screen.getDisplayMatching(bounds).scaleFactor || 1;
    dockedDrag = {
      offsetX: screenX - bounds.x,
      offsetY: screenY - bounds.y,
      width: bounds.width,
      height: bounds.height,
      scaleFactor,
      timer: setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          stopDockedDrag();
          return;
        }
        const point = screen.getCursorScreenPoint();
        const nextX = Math.round((point.x - dockedDrag.offsetX) * scaleFactor) / scaleFactor;
        const nextY = Math.round((point.y - dockedDrag.offsetY) * scaleFactor) / scaleFactor;
        const current = mainWindow.getBounds();
        if (current.x !== nextX || current.y !== nextY || current.width !== dockedDrag.width || current.height !== dockedDrag.height) {
          mainWindow.setBounds({ x: nextX, y: nextY, width: dockedDrag.width, height: dockedDrag.height });
        }
      }, 16)
    };
  });
  ipcMain.on('titlebar:docked-drag-end', stopDockedDrag);
  ipcMain.on('titlebar:navigate', (_event, url) => {
    const view = siteViews.get(activeSiteId);
    if (view && /^https?:\/\//i.test(url)) view.webContents.loadURL(url);
    hideTitlebar();
  });
  ipcMain.on('titlebar:back', () => {
    const view = siteViews.get(activeSiteId);
    if (view && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
  });
  ipcMain.on('titlebar:forward', () => {
    const view = siteViews.get(activeSiteId);
    if (view && view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward();
  });
  ipcMain.on('titlebar:reload', () => {
    const view = siteViews.get(activeSiteId);
    if (view) view.webContents.reload();
  });
  ipcMain.on('titlebar:home', () => {
    const site = siteById(activeSiteId);
    const view = siteViews.get(activeSiteId);
    const home = config.homeUrl || (site ? site.url : '');
    if (view && home) view.webContents.loadURL(home);
    hideTitlebar();
  });
  ipcMain.handle('hotkeys:get', () => currentHotkeys());
  ipcMain.handle('settings:get', () => ({
    titlebarMode: config.titlebarMode,
    version: app.getVersion(),
    proxyMode: config.proxyMode || 'system',
    proxyRules: config.proxyRules || '',
    proxyType: config.proxyType || 'http',
    proxyHost: config.proxyHost || '',
    proxyPort: config.proxyPort || '',
    proxyUser: config.proxyUser || '',
    proxyHasPass: Boolean(config.proxyPassEnc),
    accentColor: config.accentColor,
    homeUrl: config.homeUrl || '',
    theme: config.theme || 'dark',
    webTheme: config.webTheme || 'system',
    webDragStrip: Boolean(config.webDragStrip),
    webDragStripHeight: Number(config.webDragStripHeight) || 16,
    gpuEnabled: !forceSoftware
  }));
  ipcMain.handle('settings:set-titlebar-mode', (_event, mode) => setTitlebarMode(mode));
  ipcMain.handle('settings:set-theme', (_event, theme) => {
    config.theme = theme === 'light' ? 'light' : 'dark';
    configStore.save(config);
    sync.schedulePush();
    broadcastTheme();
    return { ok: true, theme: config.theme };
  });
  ipcMain.handle('settings:set-web-theme', (_event, mode) => {
    config.webTheme = ['system', 'dark', 'light'].includes(mode) ? mode : 'system';
    configStore.save(config);
    sync.schedulePush();
    applyWebTheme();
    return { ok: true, webTheme: config.webTheme };
  });
  ipcMain.handle('settings:set-home', (_event, url) => {
    const value = String(url || '').trim();
    if (value && !/^https?:\/\//i.test(value)) {
      return { ok: false, error: 'bad-url', homeUrl: config.homeUrl || '' };
    }
    config.homeUrl = value;
    configStore.save(config);
    sync.schedulePush();
    return { ok: true, homeUrl: config.homeUrl };
  });
  ipcMain.handle('settings:set-accent', (_event, color) => {
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      config.accentColor = color;
      configStore.save(config);
      sync.schedulePush();
      sendToSidebar('accent:update', { accentColor: color });
    }
    return { ok: true, accentColor: config.accentColor };
  });
  ipcMain.handle('update:check', async () => {
    try {
      return await updater.check();
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  ipcMain.handle('update:install', async (_event, info) => {
    try {
      const result = await updater.downloadAndInstall(info, { relaunchHidden: startHidden || !mainWindow.isVisible() });
      if (result.ok && result.state === 'installer-launched') {
        quitting = true;
        setTimeout(() => app.quit(), 300);
        setTimeout(() => {
          updater.updateLog('watchdog: still alive 25s after installer launch, opening releases page');
          if (panelView && !panelView.webContents.isDestroyed()) {
            panelView.webContents.send('update:progress', { phase: 'error', error: '安装未生效,已打开下载页,请手动安装。' });
          }
          updater.openReleasesPage();
        }, 25000);
      }
      return result;
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  ipcMain.handle('update:open-page', () => {
    updater.openReleasesPage();
    return { ok: true };
  });
  ipcMain.handle('settings:set-autolaunch', (_event, enabled) => {
    config.autoLaunch = Boolean(enabled);
    configStore.save(config);
    try {
      app.setLoginItemSettings({
        openAtLogin: config.autoLaunch,
        args: config.autoLaunch ? ['--hidden'] : []
      });
    } catch {
    }
    sync.schedulePush();
    return { ok: true, autoLaunch: config.autoLaunch };
  });
  ipcMain.handle('settings:about', () => ({
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    autoLaunch: config.autoLaunch
  }));
  ipcMain.handle('settings:open-user-data', () => {
    shell.openPath(app.getPath('userData'));
    return { ok: true };
  });
  ipcMain.handle('sync:status', () => sync.status());
  ipcMain.handle('sync:configure', async (_event, options) => {
    const result = await sync.configure(options || {});
    return { ...result, status: sync.status() };
  });
  ipcMain.handle('sync:set-enabled', async (_event, enabled) => {
    const result = await sync.setEnabled(enabled);
    return { ...result, status: sync.status() };
  });
  ipcMain.handle('sync:set-auto', async (_event, autoSync) => {
    const result = await sync.setAutoSync(autoSync);
    return { ...result, status: sync.status() };
  });
  ipcMain.handle('dialog:confirm-danger', async (_event, options) => {
    const parent = panelWindow && !panelWindow.isDestroyed() ? panelWindow : mainWindow;
    const result = await dialog.showMessageBox(parent, {
      type: 'warning',
      title: String((options && options.title) || '确认操作'),
      message: String((options && options.message) || ''),
      detail: String((options && options.detail) || ''),
      buttons: [String((options && options.confirmLabel) || '确定'), '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    return { ok: result.response === 0 };
  });
  ipcMain.handle('sync:upload', async () => {
    const result = await sync.push();
    return { ...result, status: sync.status() };
  });
  ipcMain.handle('sync:pull', async () => {
    const result = await sync.pull();
    return { ...result, status: sync.status() };
  });
  ipcMain.handle('hotkeys:set', (_event, { kind, id, accelerator }) =>
    setHotkey(kind, id, accelerator)
  );
  ipcMain.handle('hotkeys:clear-all', () => {
    config.switcherHotkey = '';
    config.showAppHotkey = '';
    for (const key of Object.keys(config.siteHotkeys)) config.siteHotkeys[key] = '';
    registerShortcuts();
    configStore.save(config);
    rebuildTrayMenu();
    sendToSidebar('hotkeys:update', currentHotkeys());
    sync.schedulePush();
    return { ok: true, hotkeys: currentHotkeys() };
  });
  ipcMain.handle('import:run', importCookies);
  ipcMain.handle('mechanisms:list', () => mechanisms.list());
  ipcMain.handle('import:register-host', () => {
    try {
      nativeHost.register();
      return { ok: true, extensionId: safeExtensionId() };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  ipcMain.handle('import:open-extensions-page', () => {
    shell.openExternal(`${defaultBrowserScheme()}://extensions/`);
  });
  ipcMain.handle('import:extension-path', () => (
    app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(ROOT, 'extension')
  ));
  ipcMain.on('site:open-external', (_event, id) => {
    const site = siteById(id);
    if (site) shell.openExternal(site.url);
  });
  ipcMain.on('site:reload', (_event, id) => {
    const view = siteViews.get(id);
    if (view) view.webContents.reload();
  });
  ipcMain.on('site:context-menu', (_event, id) => {
    const site = siteById(id);
    if (!site) return;
    const menu = Menu.buildFromTemplate([
      {
        label: '刷新',
        click: () => {
          const view = siteViews.get(id);
          if (view) view.webContents.reload();
        }
      },
      {
        label: '刷新回到首页',
        click: () => {
          const wasActive = activeSiteId === id;
          closeSiteView(id);
          if (wasActive) activateSite(id);
        }
      },
      {
        label: '关闭',
        click: () => closeSiteView(id)
      },
      {
        label: site.enabled ? '隐藏' : '显示',
        click: () => setSiteVisible(id, !site.enabled)
      },
      {
        label: '在默认浏览器打开',
        click: () => shell.openExternal(site.url)
      },
      {
        label: '清除数据…',
        click: () => confirmClearSiteData(id)
      },
      { type: 'separator' },
      {
        label: '配置…',
        click: () => {
          showMainWindow();
          openPanel('site-config', { site });
        }
      },
      { type: 'separator' },
      {
        label: '删除…',
        click: () => confirmDeleteSite(id)
      }
    ]);
    menu.popup({ window: mainWindow });
  });
  ipcMain.on('site:close', (_event, id) => closeSiteView(id));
  ipcMain.on('site:restore', (_event, id) => {
    setSiteVisible(id, true);
    activateSite(id);
  });
  ipcMain.on('site:open-config', (_event, id) => {
    const site = siteById(id);
    if (!site) return;
    showMainWindow();
    openPanel('site-config', { site });
  });
  ipcMain.handle('sites:get-all', () => sites);
  ipcMain.handle('sites:fetch-icon', async (_event, id) => {
    const site = siteById(id);
    if (!site) return { ok: false, error: 'not-found' };
    if (!siteViews.has(id)) createSiteView(site);
    site.icon = '';
    await tryFetchFavicon(id);
    const updated = siteById(id);
    return { ok: Boolean(updated.icon), icon: updated.icon || '' };
  });
  ipcMain.handle('settings:set-proxy', async (_event, mode, rules) => {
    config.proxyMode = mode === 'custom' ? 'custom' : 'system';
    config.proxyRules = String(rules || '').trim();
    configStore.save(config);
    sync.schedulePush();
    await applyProxy();
    return { ok: true, proxyMode: config.proxyMode, proxyRules: config.proxyRules };
  });
  ipcMain.handle('settings:set-proxy-structured', async (_event, options) => {
    const opts = options || {};
    if (opts.mode === 'system') {
      config.proxyMode = 'system';
    } else if (opts.mode === 'direct') {
      config.proxyMode = 'direct';
    } else {
      const host = String(opts.host || '').trim();
      const port = String(opts.port || '').trim();
      if (!host || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        return { ok: false, error: '请填写有效的服务器和端口(1-65535)' };
      }
      config.proxyMode = 'custom';
      config.proxyType = opts.type === 'socks5' ? 'socks5' : 'http';
      config.proxyHost = host;
      config.proxyPort = port;
      config.proxyUser = String(opts.username || '').trim();
      config.proxyRules = buildProxyRules(config.proxyType, host, port);
      if (opts.password) {
        config.proxyPassEnc = safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(String(opts.password)).toString('base64')
          : Buffer.from(String(opts.password)).toString('base64');
      }
    }
    configStore.save(config);
    sync.schedulePush();
    await applyProxy();
    attachProxyAuth();
    return { ok: true, proxyMode: config.proxyMode };
  });
  ipcMain.handle('sites:reorder', (_event, orderedIds) => {
    const byId = new Map(sites.map((site) => [site.id, site]));
    const reordered = [];
    for (const id of orderedIds) {
      if (byId.has(id)) {
        reordered.push(byId.get(id));
        byId.delete(id);
      }
    }
    for (const site of sites) {
      if (byId.has(site.id)) reordered.push(site);
    }
    sites = reordered;
    persistSites();
    registerShortcuts();
    broadcastSites();
    return { ok: true };
  });
  ipcMain.handle('sites:update', (_event, { id, patch }) => {
    const site = siteById(id);
    if (!site) return { ok: false, error: 'not-found' };
    if (typeof patch.name === 'string' && patch.name.trim()) {
      site.name = patch.name.trim();
      if (!patch.letter) site.letter = site.name.charAt(0).toUpperCase();
    }
    if (typeof patch.url === 'string' && /^https?:\/\//i.test(patch.url.trim())) {
      const newUrl = patch.url.trim();
      if (newUrl !== site.url) {
        site.url = newUrl;
        try {
          const host = new URL(newUrl).hostname.replace(/^www\./, '');
          if (!site.domains.includes(host)) site.domains.push(host);
        } catch {
        }
        sitesStore.ensureRootDomain(site);
        site.icon = '';
        const view = siteViews.get(id);
        if (view) {
          view.webContents.loadURL(newUrl);
        } else {
          const fresh = createSiteView(site);
          if (activeSiteId === id) {
            mainWindow.contentView.addChildView(fresh);
            layoutViews();
          }
        }
      }
    }
    if (typeof patch.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.color)) site.color = patch.color;
    if (typeof patch.letter === 'string' && patch.letter.trim()) site.letter = patch.letter.trim().charAt(0).toUpperCase();
    if (typeof patch.icon === 'string') site.icon = patch.icon;
    if (typeof patch.openInApp === 'boolean') site.openInApp = patch.openInApp;
    if (typeof patch.enabled === 'boolean') {
      setSiteVisible(id, patch.enabled);
    }
    persistSites();
    registerShortcuts();
    rebuildTrayMenu();
    broadcastSites();
    if (config.titlebarMode === 'docked') pushTitlebarState();
    return { ok: true, site };
  });
  ipcMain.handle('sites:add', (_event, { name, url, color, icon, openInApp, hotkey }) => {
    if (!name || !/^https?:\/\//i.test(url || '')) return { ok: false, error: 'invalid' };
    let id = `custom-${Date.now().toString(36)}`;
    const site = sitesStore.normalizeSite({
      id,
      name,
      url,
      color: color || '#4d6bfe',
      icon: typeof icon === 'string' ? icon : '',
      openInApp: openInApp === true,
      enabled: true
    });
    sitesStore.ensureRootDomain(site);
    sites.push(site);
    persistSites();
    createSiteView(site);
    recentOrder.push(id);
    if (typeof hotkey === 'string' && hotkey) {
      config.siteHotkeys[id] = hotkey;
      configStore.save(config);
    }
    registerShortcuts();
    broadcastSites();
    activateSite(id);
    return { ok: true, site };
  });
  ipcMain.handle('sites:pick-icon', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图标',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'ico', 'gif'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    if (buffer.length > 512 * 1024) return { ok: false, error: 'too-large' };
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.gif': 'image/gif' }[ext] || 'image/png';
    return { ok: true, icon: `data:${mime};base64,${buffer.toString('base64')}` };
  });
  ipcMain.handle('sites:delete', (_event, id) => confirmDeleteSite(id));
}

async function confirmClearSiteData(id) {
  const site = siteById(id);
  if (!site) return;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '清除站点数据',
    message: `确定清除「${site.name}」的本地数据吗?`,
    detail: '将清除该站点在本应用内的 Cookie、缓存与登录态,需重新登录或重新导入。快捷键、图标等站点设置不受影响。',
    buttons: ['清除', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) return;
  try {
    await session.fromPartition(`persist:${id}`).clearStorageData();
  } catch {
  }
  const view = siteViews.get(id);
  if (view && !view.webContents.isDestroyed()) view.webContents.reload();
}

async function confirmDeleteSite(id) {
  const site = siteById(id);
  if (!site) return { ok: false, error: 'not-found' };
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '删除站点',
    message: `确定删除「${site.name}」吗?`,
    detail: '将移除该站点及其本地登录数据,此操作不可撤销。',
    buttons: ['删除', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) return { ok: false, canceled: true };
  removeSiteView(id);
  sites = sites.filter((item) => item.id !== id);
  delete config.siteHotkeys[id];
  configStore.save(config);
  persistSites();
  try {
    await session.fromPartition(`persist:${id}`).clearStorageData();
  } catch {
  }
  if (activeSiteId === id) {
    activeSiteId = null;
    const next = enabledSites()[0];
    if (next) activateSite(next.id);
  }
  registerShortcuts();
  broadcastSites();
  return { ok: true };
}

function removeSiteView(id) {
  const view = siteViews.get(id);
  if (!view) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(view);
  }
  siteViews.delete(id);
  view.webContents.close();
  const index = recentOrder.indexOf(id);
  if (index !== -1) recentOrder.splice(index, 1);
}

function setSiteVisible(id, visible) {
  const site = siteById(id);
  if (!site) return;
  site.enabled = visible;
  persistSites();
  if (visible) {
    if (!recentOrder.includes(id)) recentOrder.push(id);
  } else {
    closeSiteView(id);
  }
  registerShortcuts();
  broadcastSites();
  broadcastOpened();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit-for-update')) {
      quitting = true;
      app.quit();
      return;
    }
    showMainWindow();
  });
  app.whenReady().then(() => {
    config = configStore.load();
    sites = sitesStore.load();
    applyWebTheme();
    applyProxy().catch(() => {});
    attachProxyAuth();
    downloads.init({
      change: (list) => {
        sendToSidebar('downloads:update', { downloads: list });
        if (panelView && !panelView.webContents.isDestroyed()) {
          panelView.webContents.send('downloads:update', { downloads: list });
        }
      }
    });
    try {
      nativeHost.register();
    } catch {
    }
    try {
      app.setLoginItemSettings({ openAtLogin: Boolean(config.autoLaunch), args: config.autoLaunch ? ['--hidden'] : [] });
    } catch {
    }
    updater.init({
      progress: (info) => {
        if (panelView && !panelView.webContents.isDestroyed()) {
          panelView.webContents.send('update:progress', info);
        }
      }
    });
    sync.init({
      getState: () => config,
      persist: (cfg) => {
        config = cfg;
        configStore.save(config);
      },
      status: (syncState) => {
        if (panelView && !panelView.webContents.isDestroyed()) {
          panelView.webContents.send('sync:status', syncState);
        }
      },
      onRemoteProfile: (profile) => {
        for (const key of configStore.PROFILE_KEYS) {
          if (profile[key] !== undefined) config[key] = profile[key];
        }
        config.siteHotkeys = { ...(profile.siteHotkeys || {}) };
        config.revision = profile.revision || config.revision;
        configStore.save(config);
        registerShortcuts();
        layoutViews();
        broadcastSites();
        broadcastTheme();
        sendToSidebar('accent:update', { accentColor: config.accentColor });
      },
      onRemoteSites: (remoteSites) => {
        sites = remoteSites.map((site) => sitesStore.ensureRootDomain(sitesStore.normalizeSite(site)));
        persistSites();
        registerShortcuts();
        broadcastSites();
      }
    });
    setupIpc();
    createMainWindow();
    if (config.titlebarMode === 'docked') ensureTitlebarWindow();
    createTray();
    registerShortcuts();
    app.on('activate', showMainWindow);
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
  });
}
