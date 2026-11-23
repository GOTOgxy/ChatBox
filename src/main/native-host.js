const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { app } = require('electron');

const HOST_NAME = 'com.chatai.cookie_import';

function extensionId() {
  const key = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'key.txt'), 'utf8').trim();
  const der = Buffer.from(key, 'base64');
  const hash = require('crypto').createHash('sha256').update(der).digest();
  return Array.from(hash.subarray(0, 16))
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
}

function hostScriptPath() {
  return path.join(app.getPath('userData'), 'native-host', 'host.js');
}

function hostManifestPath() {
  return path.join(app.getPath('userData'), 'native-host', `${HOST_NAME}.json`);
}

function ensureHostFiles() {
  const dir = path.dirname(hostScriptPath());
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'native-host', 'host.js'));
  fs.writeFileSync(hostScriptPath(), source);
  const launcher =
    process.platform === 'win32'
      ? path.join(dir, 'host.cmd')
      : path.join(dir, 'host.sh');
  if (process.platform === 'win32') {
    fs.writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${hostScriptPath()}"\r\n`);
  } else {
    fs.writeFileSync(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${hostScriptPath()}"\n`, { mode: 0o755 });
  }
  const manifest = {
    name: HOST_NAME,
    description: 'ChatBox cookie import host',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId()}/`]
  };
  fs.writeFileSync(hostManifestPath(), JSON.stringify(manifest, null, 2));
  return launcher;
}

function register() {
  ensureHostFiles();
  const manifest = hostManifestPath();
  if (process.platform === 'win32') {
    execFileSync('reg', [
      'add',
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'
    ]);
    execFileSync('reg', [
      'add',
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
      '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'
    ]);
  } else if (process.platform === 'darwin') {
    const targets = [
      path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
      path.join(os.homedir(), 'Library/Application Support/Microsoft Edge/NativeMessagingHosts')
    ];
    for (const dir of targets) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(manifest, path.join(dir, `${HOST_NAME}.json`));
    }
  } else {
    const targets = [
      path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts'),
      path.join(os.homedir(), '.config/microsoft-edge/NativeMessagingHosts'),
      path.join(os.homedir(), '.config/chromium/NativeMessagingHosts')
    ];
    for (const dir of targets) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(manifest, path.join(dir, `${HOST_NAME}.json`));
    }
  }
}

module.exports = { register, extensionId, HOST_NAME };
