// 主世界指纹一致性补丁(frame preload,在页面脚本之前运行)。
// 仅对 Google 站点会话注册;全部 try/catch,任何一项失败都不影响页面。
// 两种模式:
//  - accounts.google.com 登录页:网络层已伪装 Firefox,这里不能泄露 Chrome 特征
//    (window.chrome / Chrome PDF 插件 / navigator.userAgentData 都是 Chromium 独有)。
//  - 其他 Google 页面(gemini 等):补齐 Chrome 特征,与 Chrome UA + client hints 保持一致。
(() => {
  'use strict';

  const spoofFirefox = /(^|\.)accounts\.google\.com$/.test(location.hostname);

  // 去掉自动化标记(引擎层 disable-blink-features 已处理,这里兜底)
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}

  // 补齐 window.chrome(真实 Chrome 必有,Electron 缺失或不完整)
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

  // 语言列表(真实浏览器非空;Chrome / Firefox 都适用)
  function patchLanguages() {
    try {
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: () => ['zh-CN', 'zh', 'en-US', 'en'],
        configurable: true
      });
    } catch (e) {}
  }

  // permissions 与 Notification.permission 保持一致(自动化常见破绽)
  function patchPermissions() {
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
  }

  // plugins / mimeTypes 非空(真实 Chrome 含 PDF 插件)
  function patchPlugins() {
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
  }

  // Firefox 没有 navigator.userAgentData(Chromium 独有),伪装 Firefox 时抹掉
  function hideChromiumApis() {
    try {
      Object.defineProperty(navigator, 'userAgentData', { get: () => undefined, configurable: true });
    } catch (e) {}
    try {
      if (window.chrome) Object.defineProperty(window, 'chrome', { value: undefined, configurable: true, writable: true });
    } catch (e) {}
  }

  function apply() {
    patchLanguages();
    patchPermissions();
    if (spoofFirefox) {
      hideChromiumApis();
    } else {
      patchChrome();
      patchPlugins();
    }
  }

  apply();
  // window.chrome / languages 可能被内核在 preload 之后重置,DOMContentLoaded 时再补一次。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  }
  setTimeout(apply, 0);
})();