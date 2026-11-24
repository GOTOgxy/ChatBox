const fs = require('fs');
const path = require('path');
const { app, safeStorage, net } = require('electron');

const SYNC_FILES = ['profile.json', 'sites.json'];

let state = null;
let pushTimer = null;
let pollTimer = null;
let onStatus = () => {};
let getLocalConfig = () => null;
let saveLocalConfig = () => {};
let applyRemote = () => {};

function init({ getState, persist, onRemoteProfile, onRemoteSites, status }) {
  getLocalConfig = getState;
  saveLocalConfig = persist;
  onStatus = status || (() => {});
  applyRemote = ({ profile, sites }) => {
    if (profile && onRemoteProfile) onRemoteProfile(profile);
    if (sites && onRemoteSites) onRemoteSites(sites);
  };
  state = getLocalConfig().sync;
  startPolling();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  const cfg = getLocalConfig().sync;
  if (cfg.enabled && cfg.autoSync && cfg.serverUrl) {
    setTimeout(() => pull().catch(() => {}), 3000);
    pollTimer = setInterval(() => pull().catch(() => {}), 30 * 60 * 1000);
  }
}

function credentials() {
  const cfg = getLocalConfig().sync;
  let password = '';
  if (cfg.passwordEnc) {
    try {
      password = safeStorage.decryptString(Buffer.from(cfg.passwordEnc, 'base64'));
    } catch {
      password = '';
    }
  }
  return { username: cfg.username, password };
}

function baseUrl() {
  const cfg = getLocalConfig().sync;
  const server = String(cfg.serverUrl || '').replace(/\/+$/, '');
  const dir = String(cfg.remoteDir || '/ChatBox/').replace(/^\/?/, '/').replace(/\/?$/, '/');
  return server + dir;
}

function authHeader() {
  const { username, password } = credentials();
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

async function request(method, url, body) {
  const response = await net.fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(method === 'PROPFIND' ? { Depth: '0' } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return response;
}

function setStatus(patch) {
  const cfg = getLocalConfig();
  cfg.sync = { ...cfg.sync, ...patch };
  saveLocalConfig(cfg);
  onStatus(cfg.sync);
}

function validateProfile(data) {
  return data && typeof data === 'object' && typeof data.switcherHotkey === 'string';
}

function validateSites(data) {
  return Array.isArray(data) && data.every((site) => site && typeof site.id === 'string' && typeof site.url === 'string');
}

async function pull() {
  const cfg = getLocalConfig().sync;
  if (!cfg.enabled || !cfg.serverUrl) return { ok: false, error: 'not-configured' };
  try {
    const remote = {};
    for (const name of SYNC_FILES) {
      const response = await request('GET', baseUrl() + name);
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (name === 'profile.json' && !validateProfile(data)) throw new Error('bad-profile');
      if (name === 'sites.json' && !validateSites(data)) throw new Error('bad-sites');
      remote[name] = data;
    }
    const localProfile = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'profile.json'), 'utf8'));
    const remoteProfile = remote['profile.json'];
    if (remoteProfile && (remoteProfile.revision || 0) > (localProfile.revision || 0)) {
      applyRemote({ profile: remoteProfile, sites: remote['sites.json'] });
    } else if (remoteProfile && remoteProfile.updatedAt > localProfile.updatedAt) {
      fs.writeFileSync(
        path.join(app.getPath('userData'), `profile.conflict-${Date.now()}.json`),
        JSON.stringify(localProfile, null, 2)
      );
      applyRemote({ profile: remoteProfile, sites: remote['sites.json'] });
    } else if (remote['sites.json'] && !remoteProfile) {
      applyRemote({ sites: remote['sites.json'] });
    }
    setStatus({ lastSyncAt: Date.now(), lastError: '' });
    return { ok: true };
  } catch (error) {
    setStatus({ lastError: String(error.message || error).slice(0, 120) });
    return { ok: false, error: String(error.message || error) };
  }
}

async function push() {
  const cfg = getLocalConfig().sync;
  if (!cfg.enabled || !cfg.serverUrl) return { ok: false, error: 'not-configured' };
  try {
    await request('MKCOL', baseUrl().replace(/\/$/, ''));
    for (const name of SYNC_FILES) {
      const local = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), name), 'utf8'));
      if (name === 'profile.json' && !validateProfile(local)) continue;
      if (name === 'sites.json' && !validateSites(local)) continue;
      const response = await request('PUT', baseUrl() + name, local);
      if (!response.ok && response.status !== 409) throw new Error(`HTTP ${response.status}`);
    }
    setStatus({ lastSyncAt: Date.now(), lastError: '' });
    return { ok: true };
  } catch (error) {
    setStatus({ lastError: String(error.message || error).slice(0, 120) });
    return { ok: false, error: String(error.message || error) };
  }
}

function schedulePush() {
  const cfg = getLocalConfig().sync;
  if (!cfg.enabled || !cfg.autoSync) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push().catch(() => {}), 30 * 1000);
}

async function configure({ serverUrl, username, password, remoteDir }) {
  const cfg = getLocalConfig();
  const sync = { ...cfg.sync };
  if (serverUrl !== undefined) sync.serverUrl = String(serverUrl).trim();
  if (username !== undefined) sync.username = String(username).trim();
  if (remoteDir !== undefined) sync.remoteDir = String(remoteDir).trim() || '/ChatBox/';
  if (password) {
    sync.passwordEnc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(password).toString('base64')
      : Buffer.from(password).toString('base64');
  }
  cfg.sync = sync;
  saveLocalConfig(cfg);
  onStatus(cfg.sync);
  if (!sync.serverUrl || !sync.username || !sync.passwordEnc) {
    return { ok: true, test: { ok: false, error: '服务器、账号与应用密码填写完整后才能测试连接' } };
  }
  try {
    const probe = await request('PROPFIND', baseUrl().replace(/\/$/, ''));
    if (probe.status === 401 || probe.status === 403) {
      return { ok: true, test: { ok: false, error: `认证失败 (HTTP ${probe.status})` } };
    }
    if (!probe.ok && probe.status !== 404 && probe.status !== 405) {
      return { ok: true, test: { ok: false, error: `HTTP ${probe.status}` } };
    }
    return { ok: true, test: { ok: true } };
  } catch (error) {
    return { ok: true, test: { ok: false, error: String(error.message || error).slice(0, 120) } };
  }
}

async function setEnabled(enabled) {
  const cfg = getLocalConfig();
  if (enabled) {
    if (!cfg.sync.serverUrl || !cfg.sync.username || !cfg.sync.passwordEnc) {
      return { ok: false, error: '启用同步前请先填写服务器、账号与应用密码并保存' };
    }
    try {
      const probe = await request('PROPFIND', baseUrl().replace(/\/$/, ''));
      if (probe.status === 401 || probe.status === 403) {
        return { ok: false, error: `连接测试失败:认证失败 (HTTP ${probe.status}),请修改配置后重试` };
      }
      if (!probe.ok && probe.status !== 404 && probe.status !== 405) {
        return { ok: false, error: `连接测试失败:HTTP ${probe.status},请修改配置后重试` };
      }
    } catch (error) {
      return { ok: false, error: `连接测试失败:${String(error.message || error).slice(0, 80)},请修改配置后重试` };
    }
  }
  cfg.sync.enabled = Boolean(enabled);
  if (!enabled) cfg.sync.autoSync = false;
  saveLocalConfig(cfg);
  clearTimeout(pushTimer);
  startPolling();
  onStatus(cfg.sync);
  return { ok: true };
}

async function setAutoSync(autoSync) {
  const cfg = getLocalConfig();
  if (autoSync && !cfg.sync.enabled) {
    return { ok: false, error: '请先启用同步' };
  }
  cfg.sync.autoSync = Boolean(autoSync);
  saveLocalConfig(cfg);
  clearTimeout(pushTimer);
  startPolling();
  onStatus(cfg.sync);
  return { ok: true };
}

function status() {
  const cfg = getLocalConfig().sync;
  return {
    enabled: cfg.enabled,
    autoSync: cfg.autoSync,
    serverUrl: cfg.serverUrl,
    username: cfg.username,
    remoteDir: cfg.remoteDir,
    hasPassword: Boolean(cfg.passwordEnc),
    lastSyncAt: cfg.lastSyncAt,
    lastError: cfg.lastError
  };
}

module.exports = { init, pull, push, schedulePush, configure, setEnabled, setAutoSync, status };
