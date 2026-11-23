const registry = require('./index');

async function fetchIconInPage(view, iconUrl) {
  return view.webContents.executeJavaScript(`(async () => {
    try {
      const response = await fetch(${JSON.stringify(iconUrl)}, { credentials: 'omit' });
      if (!response.ok) return { error: 'http-' + response.status };
      const type = response.headers.get('content-type') || '';
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > 512 * 1024) return { error: 'size-' + buffer.byteLength };
      const bytes = new Uint8Array(buffer);
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const isGif = bytes[0] === 0x47 && bytes[1] === 0x49;
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45;
      const isIco = bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01;
      const head = new TextDecoder().decode(bytes.subarray(0, 256)).trim().toLowerCase();
      const isSvg = head.startsWith('<svg') || head.startsWith('<?xml');
      if (!type.startsWith('image/') && !isPng && !isGif && !isJpeg && !isWebp && !isIco && !isSvg) {
        return { error: 'not-image type=' + type };
      }
      const mime = type.startsWith('image/') ? type.split(';')[0].trim()
        : isSvg ? 'image/svg+xml' : isIco ? 'image/x-icon' : isPng ? 'image/png'
        : isGif ? 'image/gif' : isJpeg ? 'image/jpeg' : 'image/webp';
      let binary = '';
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
      return { data: 'data:' + mime + ';base64,' + btoa(binary) };
    } catch (error) { return { error: String(error).slice(0, 80) }; }
  })()`);
}

async function run({ site, getView }) {
  if (!site) return { ok: false, error: 'no-site' };
  let view = getView(site.id);
  if (!view || view.webContents.isDestroyed()) return { ok: false, error: 'no-view' };
  if (view.webContents.isLoading()) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 15000);
      view.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  let href = '';
  try {
    href = await view.webContents.executeJavaScript(`(() => {
      const link = document.querySelector('link[rel~="icon"]');
      return link ? link.href : '';
    })()`);
  } catch {
  }
  const candidates = [];
  if (href) candidates.push(href);
  const origin = new URL(site.url).origin;
  candidates.push(`${origin}/favicon.ico`);
  candidates.push(`https://www.google.com/s2/favicons?domain=${new URL(site.url).hostname}&sz=64`);
  for (const iconUrl of candidates) {
    try {
      const result = await fetchIconInPage(view, iconUrl);
      if (result && result.data) return { ok: true, icon: result.data };
    } catch {
    }
  }
  return { ok: false };
}

registry.register({
  id: 'icon-fetch',
  name: '图标获取',
  description: '按 link[rel=icon] → /favicon.ico → favicon 服务的规则链抓取站点图标',
  run
});

module.exports = { run };
