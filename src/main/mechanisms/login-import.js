const registry = require('./index');

function domainMatches(domain, allowed) {
  const clean = (domain || '').replace(/^\./, '');
  return allowed.some((entry) => clean === entry || clean.endsWith(`.${entry}`));
}

function normalizeSameSite(value) {
  if (value === 'no_restriction') return 'no_restriction';
  if (value === 'lax') return 'lax';
  if (value === 'strict') return 'strict';
  return 'unspecified';
}

async function importCookies({ sites, getSession, data }) {
  const cookies = Array.isArray(data.cookies) ? data.cookies : [];
  const imported = {};
  const failures = {};
  for (const site of sites) {
    const partition = getSession(site);
    let count = 0;
    const failedNames = [];
    for (const cookie of cookies) {
      if (!domainMatches(cookie.domain, site.domains)) continue;
      const domain = (cookie.domain || '').replace(/^\./, '');
      const isHostPrefixed = cookie.name.startsWith('__Host-') || cookie.name.startsWith('__Secure-');
      const url = isHostPrefixed ? `https://${domain}/` : `https://${domain}${cookie.path || '/'}`;
      const secure = Boolean(cookie.secure);
      const sameSite = normalizeSameSite(cookie.sameSite);
      try {
        await partition.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.name.startsWith('__Host-') ? undefined : cookie.domain,
          path: cookie.name.startsWith('__Host-') ? '/' : (cookie.path || '/'),
          secure,
          httpOnly: Boolean(cookie.httpOnly),
          expirationDate: cookie.expirationDate,
          sameSite: sameSite === 'no_restriction' && !secure ? 'lax' : sameSite
        });
        count += 1;
      } catch (error) {
        failedNames.push(`${cookie.name}(${String(error.message || error).slice(0, 60)})`);
      }
    }
    imported[site.id] = count;
    if (failedNames.length > 0) failures[site.id] = failedNames.slice(0, 5);
  }
  return { imported, failures };
}

async function importStorage({ sites, getView, ensureView, storageByOrigin }) {
  const report = {};
  for (const site of sites) {
    const entries = {};
    for (const [origin, entriesForOrigin] of Object.entries(storageByOrigin || {})) {
      let host;
      try {
        host = new URL(origin).hostname;
      } catch {
        continue;
      }
      if (domainMatches(host, site.domains)) Object.assign(entries, entriesForOrigin);
    }
    if (Object.keys(entries).length === 0) continue;
    let view = getView(site.id);
    if ((!view || view.webContents.isDestroyed()) && ensureView) {
      view = ensureView(site);
      if (view && !view.webContents.isDestroyed() && view.webContents.isLoading()) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 15000);
          view.webContents.once('did-finish-load', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    }
    if (!view || view.webContents.isDestroyed()) continue;
    try {
      await view.webContents.executeJavaScript(`(() => {
        const entries = ${JSON.stringify(entries)};
        for (const [key, value] of Object.entries(entries)) {
          try { localStorage.setItem(key, value); } catch {}
        }
        return Object.keys(entries).length;
      })()`);
      report[site.id] = Object.keys(entries).length;
    } catch {
    }
  }
  return report;
}

async function run(context) {
  const { data, sites, getSession, getView, ensureView } = context;
  const cookieReport = await importCookies({ sites, getSession, data });
  const storageReport = await importStorage({ sites, getView, ensureView, storageByOrigin: data.storage || {} });
  if (data.userAgent && context.setUserAgent) {
    const cleaned = String(data.userAgent).replace(/\s*Edg\/[\d.]+/g, '').replace(/\s*Edge\/[\d.]+/g, '');
    context.setUserAgent(cleaned);
  }
  for (const site of sites) {
    const view = getView(site.id);
    if (view && !view.webContents.isDestroyed() && (cookieReport.imported[site.id] > 0 || storageReport[site.id] > 0)) {
      view.webContents.reload();
    }
  }
  return {
    ok: true,
    imported: cookieReport.imported,
    failures: cookieReport.failures,
    storage: storageReport,
    storageStatus: data.storageStatus || {}
  };
}

registry.register({
  id: 'login-import',
  name: '登录态导入',
  description: '按站点域名规则集注入 Cookie 与 localStorage,对齐 UA 并刷新',
  run
});

module.exports = { run, domainMatches };
