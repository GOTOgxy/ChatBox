const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { SITES: DEFAULT_SITES } = require('../shared/sites');
const { lockSvgLight } = require('./mechanisms/icon-fetch');

function sitesPath() {
  return path.join(app.getPath('userData'), 'sites.json');
}

function normalizeSite(site) {
  const url = String(site.url || '').trim();
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }
  const domains = Array.isArray(site.domains) && site.domains.length > 0
    ? site.domains
    : hostname
      ? [hostname.replace(/^www\./, '')]
      : [];
  return {
    id: String(site.id),
    name: String(site.name || hostname || site.id),
    url,
    domains,
    color: site.color || '#4d6bfe',
    letter: site.letter || String(site.name || hostname || '?').charAt(0).toUpperCase(),
    icon: site.icon || '',
    enabled: site.enabled !== false,
    openInApp: site.openInApp === true
  };
}

function registrableDomain(hostname) {
  const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const secondLevel = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac']);
  const tail = parts.slice(-2);
  if (secondLevel.has(tail[0]) && tail[1].length <= 3) return parts.slice(-3).join('.');
  return tail.join('.');
}

function ensureRootDomain(site) {
  try {
    const root = registrableDomain(new URL(site.url).hostname);
    if (root && !site.domains.some((entry) => entry.replace(/^\./, '') === root)) {
      site.domains.push(root);
    }
  } catch {
  }
  return site;
}

function load() {
  try {
    const stored = JSON.parse(fs.readFileSync(sitesPath(), 'utf8'));
    if (Array.isArray(stored) && stored.length > 0) {
      const normalized = stored.map((site) => ensureRootDomain(normalizeSite(site)));
      for (const site of normalized) {
        if (site.icon) site.icon = lockSvgLight(site.icon);
      }
      const domainsChanged = JSON.stringify(normalized.map((site) => site.domains)) !== JSON.stringify(stored.map((site) => site.domains));
      const iconsChanged = normalized.some((site, index) => site.icon !== stored[index].icon);
      if (domainsChanged || iconsChanged) {
        save(normalized);
      }
      return normalized;
    }
  } catch {
  }
  return DEFAULT_SITES.map((site) => ensureRootDomain(normalizeSite({ ...site, enabled: true })));
}

function save(sites) {
  fs.mkdirSync(path.dirname(sitesPath()), { recursive: true });
  fs.writeFileSync(sitesPath(), JSON.stringify(sites, null, 2));
}

module.exports = { load, save, normalizeSite, ensureRootDomain, registrableDomain };
