const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { SITES } = require('../shared/sites');

const DEFAULTS = {
  userAgent: '',
  lastActive: 'chatgpt',
  titlebarMode: 'floating',
  accentColor: '#ff5fa2',
  homeUrl: '',
  proxyMode: 'system',
  proxyRules: '',
  switcherHotkey: 'Alt+Space',
  showAppHotkey: 'CommandOrControl+Shift+A',
  siteHotkeys: {
    chatgpt: 'CommandOrControl+Alt+1',
    gemini: 'CommandOrControl+Alt+2',
    qwen: 'CommandOrControl+Alt+3',
    deepseek: 'CommandOrControl+Alt+4'
  }
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  try {
    const stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    delete stored.directHotkeyPrefix;
    return {
      ...DEFAULTS,
      ...stored,
      siteHotkeys: { ...DEFAULTS.siteHotkeys, ...(stored.siteHotkeys || {}) }
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function siteById(id) {
  return SITES.find((site) => site.id === id);
}

module.exports = { load, save, siteById, configPath };
