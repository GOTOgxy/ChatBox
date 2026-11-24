const registry = require('./index');

function lockSvgLight(dataUrl) {
  if (!dataUrl.startsWith('data:image/svg+xml')) return dataUrl;
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    let svg = Buffer.from(base64, 'base64').toString('utf8');
    svg = svg.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi, '');
    return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  } catch {
    return dataUrl;
  }
}

async function fetchIconRaw(view, iconUrl) {
  // 在主进程用站点会话发起请求:不受页面 CORS 限制(google favicon 服务等跨域候选才能成功),
  // 并自动走该会话的代理设置;不依赖页面是否渲染完成。
  try {
    const response = await view.webContents.session.fetch(iconUrl, { credentials: 'omit' });
    if (!response.ok) return { error: 'http-' + response.status };
    const type = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 512 * 1024) return { error: 'size-' + buffer.length };
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    const isGif = buffer[0] === 0x47 && buffer[1] === 0x49;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45;
    const isIco = buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01;
    const head = buffer.subarray(0, 256).toString('utf8').trim().toLowerCase();
    const isSvg = head.startsWith('<svg') || head.startsWith('<?xml');
    if (!type.startsWith('image/') && !isPng && !isGif && !isJpeg && !isWebp && !isIco && !isSvg) {
      return { error: 'not-image type=' + type };
    }
    const mime = type.startsWith('image/') ? type.split(';')[0].trim()
      : isSvg ? 'image/svg+xml' : isIco ? 'image/x-icon' : isPng ? 'image/png'
      : isGif ? 'image/gif' : isJpeg ? 'image/jpeg' : 'image/webp';
    return { data: 'data:' + mime + ';base64,' + buffer.toString('base64') };
  } catch (error) {
    return { error: String(error).slice(0, 80) };
  }
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
      const result = await fetchIconRaw(view, iconUrl);
      if (result && result.data) return { ok: true, icon: lockSvgLight(result.data) };
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

module.exports = { run, lockSvgLight };
