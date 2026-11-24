// 主世界指纹一致性补丁(frame preload,在页面脚本之前运行)。
// 目的:让内嵌浏览器在 JS 侧看起来与真实 Chrome 一致,争取 Google 承认导入的登录态。
// 仅对 Google 站点会话注册;全部 try/catch,任何一项失败都不影响页面。
(() => {
  'use strict';

  // 1. 去掉自动化标记
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}

  // 2. 补齐 window.chrome(真实 Chrome 必有,Electron 缺失或不完整)
  function patchChrome() {
    try {
      const t = Date.now() / 1000;
      const full = {
        runtime: {},
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
        },
        csi: function () {
          return { onloadT: Date.now(), startE: Date.now(), pageT: Math.round(performance.now()), tran: 15 };
        },
        loadTimes: function () {
          return {
            requestTime: t - 1, startLoadTime: t - 1, commitLoadTime: t - 0.6,
            finishDocumentLoadTime: t - 0.4, finishLoadTime: t - 0.2, firstPaintTime: t - 0.1,
            firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true,
            wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
            wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
          };
        }
      };
      const existing = window.chrome;
      if (existing && typeof existing === 'object') {
        for (const key of Object.keys(existing)) {
          try { if (!(key in full)) full[key] = existing[key]; } catch (e) {}
        }
      }
      Object.defineProperty(window, 'chrome', { value: full, configurable: true, writable: true });
    } catch (e) {}
  }

  // 3. 语言列表(真实浏览器非空;覆盖原型上的 getter)
  function patchLanguages() {
    try {
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: () => ['zh-CN', 'zh', 'en-US', 'en'],
        configurable: true
      });
    } catch (e) {}
  }

  // 4. permissions 与 Notification.permission 保持一致(自动化常见破绽)
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (parameters) => {
        if (parameters && parameters.name === 'notifications' && typeof Notification !== 'undefined') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery(parameters);
      };
    }
  } catch (e) {}

  // 5. plugins / mimeTypes 非空(真实 Chrome 含 PDF 插件)
  try {
    const makePlugin = (name, filename, description, mimes) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: name },
        filename: { value: filename },
        description: { value: description },
        length: { value: mimes.length }
      });
      mimes.forEach((mime, index) => {
        const mimeType = Object.create(MimeType.prototype);
        Object.defineProperties(mimeType, {
          type: { value: mime.type },
          suffixes: { value: mime.suffixes },
          description: { value: mime.description },
          enabledPlugin: { value: plugin }
        });
        plugin[index] = mimeType;
      });
      return plugin;
    };
    const pdfMimes = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
    ];
    const plugins = [
      makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      makePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      makePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes)
    ];
    const pluginArray = Object.create(PluginArray.prototype);
    plugins.forEach((plugin, index) => {
      pluginArray[index] = plugin;
      pluginArray[plugin.name] = plugin;
    });
    Object.defineProperty(pluginArray, 'length', { value: plugins.length });
    pluginArray.item = (index) => plugins[index] || null;
    pluginArray.namedItem = (name) => plugins.find((plugin) => plugin.name === name) || null;
    pluginArray.refresh = () => {};
    Object.defineProperty(navigator, 'plugins', { get: () => pluginArray, configurable: true });

    const mimeArray = Object.create(MimeTypeArray.prototype);
    const allMimes = pdfMimes.map((mime) => {
      const mimeType = Object.create(MimeType.prototype);
      Object.defineProperties(mimeType, {
        type: { value: mime.type },
        suffixes: { value: mime.suffixes },
        description: { value: mime.description },
        enabledPlugin: { value: plugins[0] }
      });
      return mimeType;
    });
    allMimes.forEach((mime, index) => {
      mimeArray[index] = mime;
      mimeArray[mime.type] = mime;
    });
    Object.defineProperty(mimeArray, 'length', { value: allMimes.length });
    mimeArray.item = (index) => allMimes[index] || null;
    mimeArray.namedItem = (type) => allMimes.find((mime) => mime.type === type) || null;
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeArray, configurable: true });
  } catch (e) {}

  // chrome / languages 可能被内核在 preload 之后重新初始化,DOMContentLoaded 时再补一次。
  patchChrome();
  patchLanguages();
  const reapply = () => { patchChrome(); patchLanguages(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reapply, { once: true });
  }
  setTimeout(reapply, 0);
})();