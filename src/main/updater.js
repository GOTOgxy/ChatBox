const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app, net, shell } = require('electron');
const { spawn } = require('child_process');

const REPO = 'GOTOgxy/ChatBox';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

let onProgress = () => {};

function updateLog(line) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
  }
}

function init({ progress }) {
  onProgress = progress || (() => {});
}

async function check() {
  const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'ChatBox-Update-Check', Accept: 'application/vnd.github+json' }
  });
  if (response.status === 404) return { ok: true, state: 'no-release', current: app.getVersion() };
  if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
  const data = await response.json();
  const latest = String(data.tag_name || '').replace(/^v/, '');
  const asset = (data.assets || []).find((item) => /^ChatBox-Setup-.*\.exe$/i.test(item.name));
  const checksums = (data.assets || []).find((item) => /checksums/i.test(item.name));
  return {
    ok: true,
    state: latest && latest !== app.getVersion() ? 'available' : 'up-to-date',
    current: app.getVersion(),
    latest,
    notes: String(data.body || '').slice(0, 500),
    downloadUrl: asset ? asset.browser_download_url : '',
    assetName: asset ? asset.name : '',
    checksumsUrl: checksums ? checksums.browser_download_url : '',
    pageUrl: data.html_url || RELEASES_PAGE
  };
}

async function downloadToFile(url, dest, expectedSha256) {
  let fullRestart = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let existing = 0;
      if (!fullRestart && fs.existsSync(dest)) {
        const stat = fs.statSync(dest);
        if (stat.size > 0) existing = stat.size;
      }
      if (existing === 0 && fs.existsSync(dest)) fs.unlinkSync(dest);
      const response = await net.fetch(url, {
        headers: existing > 0 ? { Range: `bytes=${existing}-` } : {}
      });
      if (response.status === 416) {
        fullRestart = true;
        try { fs.unlinkSync(dest); } catch {}
        throw new Error('HTTP 416 (range reset)');
      }
      if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
      const append = response.status === 206 && existing > 0;
      const out = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });
      const hash = crypto.createHash('sha256');
      if (append) {
        const prior = fs.readFileSync(dest);
        hash.update(prior);
      }
      let received = append ? existing : 0;
      const total = Number(response.headers.get('content-length') || 0) + received;
      for await (const chunk of response.body) {
        if (!out.write(chunk)) {
          await new Promise((resolve) => out.once('drain', resolve));
        }
        hash.update(chunk);
        received += chunk.length;
        if (total > 0) onProgress({ phase: 'download', percent: Math.round((received / total) * 100) });
      }
      await new Promise((resolve, reject) => {
        out.end(resolve);
        out.on('error', reject);
      });
      const digest = hash.digest('hex');
      if (expectedSha256 && digest !== expectedSha256.toLowerCase()) {
        try { fs.unlinkSync(dest); } catch {}
        fullRestart = true;
        throw new Error('checksum-mismatch');
      }
      return { ok: true, path: dest, sha256: digest };
    } catch (error) {
      if (attempt === 3) return { ok: false, error: String(error.message || error) };
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  return { ok: false, error: 'unreachable' };
}

async function fetchExpectedSha256(checksumsUrl, assetName) {
  if (!checksumsUrl || !assetName) return '';
  try {
    const response = await net.fetch(checksumsUrl);
    if (!response.ok) return '';
    const text = await response.text();
    for (const line of text.split(/\r?\n/)) {
      const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (match && match[2].trim() === assetName) return match[1];
    }
  } catch {
  }
  return '';
}

async function downloadAndInstall(info, { relaunchHidden }) {
  if (process.platform !== 'win32') {
    shell.openExternal(info.pageUrl || RELEASES_PAGE);
    return { ok: true, state: 'opened-browser' };
  }
  if (!info.downloadUrl) {
    shell.openExternal(info.pageUrl || RELEASES_PAGE);
    return { ok: false, error: 'no-asset', state: 'opened-browser' };
  }
  onProgress({ phase: 'download', percent: 0 });
  const dest = path.join(os.tmpdir(), info.assetName || 'ChatBox-Setup.exe');
  const expected = await fetchExpectedSha256(info.checksumsUrl, info.assetName);
  const result = await downloadToFile(info.downloadUrl, dest, expected);
  if (!result.ok) {
    updateLog(`download failed: ${result.error}`);
    return { ok: false, error: result.error, state: 'download-failed', pageUrl: info.pageUrl || RELEASES_PAGE };
  }
  updateLog(`download ok: ${dest} sha256=${result.sha256}`);
  onProgress({ phase: 'installing', percent: 100 });
  try {
    spawn(process.execPath, ['--quit-for-update'], { detached: true, stdio: 'ignore' }).unref();
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } catch {
  }
  const args = ['/S'];
  if (relaunchHidden) args.push('--hidden');
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(dest, args, { detached: true, stdio: 'ignore', env: cleanEnv });
    child.unref();
    updateLog(`installer spawned: ${dest} ${args.join(' ')}`);
  } catch (error) {
    updateLog(`installer spawn failed: ${error.message || error}`);
    shell.openExternal(info.pageUrl || RELEASES_PAGE);
    return { ok: false, error: String(error.message || error), state: 'spawn-failed', pageUrl: info.pageUrl || RELEASES_PAGE };
  }
  return { ok: true, state: 'installer-launched' };
}

function openReleasesPage() {
  shell.openExternal(RELEASES_PAGE);
}

module.exports = { init, check, downloadAndInstall, openReleasesPage, updateLog, RELEASES_PAGE };
