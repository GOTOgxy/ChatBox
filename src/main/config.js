const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { SITES } = require('../shared/sites');

const PROFILE_DEFAULTS = {
  titlebarMode: 'floating',
  theme: 'dark',
  webTheme: 'system',
  webDragStrip: false,
  webDragStripHeight: 16,
  accentColor: '#ff5fa2',
  homeUrl: '',
  proxyMode: 'system',
  proxyRules: '',
  proxyType: 'http',
  proxyHost: '',
  proxyPort: '',
  proxyUser: '',
  proxyPassEnc: '',
  autoLaunch: false,
  switcherHotkey: 'Alt+Space',
  showAppHotkey: 'CommandOrControl+Shift+A',
  siteHotkeys: {
    chatgpt: 'CommandOrControl+Alt+1',
    gemini: 'CommandOrControl+Alt+2',
    qwen: 'CommandOrControl+Alt+3',
    deepseek: 'CommandOrControl+Alt+4'
  }
};

const LOCAL_DEFAULTS = {
  userAgent: '',
  lastActive: 'chatgpt',
  windowBounds: null,
  sync: {
    enabled: false,
    autoSync: false,
    serverUrl: '',
    username: '',
    passwordEnc: '',
    remoteDir: '/ChatBox/',
    lastSyncAt: 0,
    lastError: ''
  }
};

const PROFILE_KEYS = Object.keys(PROFILE_DEFAULTS);
const LOCAL_KEYS = Object.keys(LOCAL_DEFAULTS);

function filePath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(name, data) {
  fs.mkdirSync(path.dirname(filePath(name)), { recursive: true });
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

function load() {
  const legacy = readJson('config.json');
  const storedProfile = readJson('profile.json');
  const storedLocal = readJson('local.json');

  const profile = { ...PROFILE_DEFAULTS, ...(storedProfile || {}) };
  const local = {
    ...LOCAL_DEFAULTS,
    ...(storedLocal || {}),
    sync: { ...LOCAL_DEFAULTS.sync, ...((storedLocal && storedLocal.sync) || {}) }
  };
  profile.siteHotkeys = { ...PROFILE_DEFAULTS.siteHotkeys, ...(profile.siteHotkeys || {}) };

  if (legacy && !storedProfile && !storedLocal) {
    for (const key of PROFILE_KEYS) {
      if (legacy[key] !== undefined) profile[key] = legacy[key];
    }
    profile.siteHotkeys = { ...PROFILE_DEFAULTS.siteHotkeys, ...(legacy.siteHotkeys || {}) };
    for (const key of LOCAL_KEYS) {
      if (legacy[key] !== undefined) local[key] = legacy[key];
    }
    delete profile.directHotkeyPrefix;
    writeJson('profile.json', { ...profile, revision: 1, updatedAt: Date.now() });
    writeJson('local.json', local);
    try {
      fs.renameSync(filePath('config.json'), filePath('config.json.migrated'));
    } catch {
    }
  }

  if (!readJson('profile.json')) {
    writeJson('profile.json', { ...profile, revision: 1, updatedAt: Date.now() });
  }
  if (!readJson('local.json')) {
    writeJson('local.json', local);
  }

  const merged = { ...profile, ...local };
  merged.revision = (storedProfile && storedProfile.revision) || 1;
  return merged;
}

function save(config) {
  const profile = { revision: (config.revision || 1) + 1, updatedAt: Date.now() };
  for (const key of PROFILE_KEYS) profile[key] = config[key];
  profile.siteHotkeys = { ...(config.siteHotkeys || {}) };
  writeJson('profile.json', profile);
  config.revision = profile.revision;

  const local = {};
  for (const key of LOCAL_KEYS) local[key] = config[key];
  local.sync = { ...LOCAL_DEFAULTS.sync, ...(config.sync || {}) };
  writeJson('local.json', local);
}

function profilePath() {
  return filePath('profile.json');
}

function localPath() {
  return filePath('local.json');
}

function siteById(id) {
  return SITES.find((site) => site.id === id);
}

module.exports = { load, save, siteById, profilePath, localPath, PROFILE_KEYS, LOCAL_KEYS };
