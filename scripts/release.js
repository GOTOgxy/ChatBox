const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = 'GOTOgxy/ChatBox';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const releaseDir = path.join(ROOT, 'release');
const distDir = path.join(ROOT, 'dist');
const tag = `v${version}`;

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}

run('node', [path.join(ROOT, 'scripts', 'pack-crx.js')]);
fs.copyFileSync(path.join(distDir, 'chatbox-cookie-bridge.crx'), path.join(releaseDir, 'chatbox-cookie-bridge.crx'));
run('node', [path.join(ROOT, 'scripts', 'make-checksums.js')]);

const localFiles = fs.readdirSync(releaseDir).filter((name) =>
  name === `ChatBox-Setup-${version}.exe` ||
  new RegExp(`^ChatBox-${version}-(arm64|x64)\\.dmg$`, 'i').test(name) ||
  name === 'chatbox-cookie-bridge.crx' ||
  name === 'checksums.txt'
);
const assets = localFiles.map((name) => path.join(releaseDir, name));

if (!assets.some((asset) => asset.endsWith('.exe') || asset.endsWith('.dmg'))) {
  console.error(`release/ has no installer for ${version}; build it first (Windows: electron-builder + ISCC; macOS: npm run dist:mac).`);
  process.exit(1);
}

let exists = false;
try {
  execFileSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore', shell: process.platform === 'win32' });
  exists = true;
} catch {
  exists = false;
}

if (exists) {
  // 合并已发布的 checksums,保留另一端上传的条目
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbox-release-'));
    execFileSync('gh', ['release', 'download', tag, '--repo', REPO, '--pattern', 'checksums.txt', '--dir', tmp, '--clobber'], { stdio: 'ignore', shell: process.platform === 'win32' });
    const localNames = new Set(localFiles);
    const remoteLines = fs.readFileSync(path.join(tmp, 'checksums.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
    const kept = remoteLines.filter((line) => {
      const name = line.trim().split(/\s+/)[1];
      return name && !localNames.has(name.replace(/^\*/, ''));
    });
    const localLines = fs.readFileSync(path.join(releaseDir, 'checksums.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
    fs.writeFileSync(path.join(releaseDir, 'checksums.txt'), [...kept, ...localLines].join('\n') + '\n');
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
  }
  run('gh', ['release', 'upload', tag, ...assets, '--repo', REPO, '--clobber']);
  console.log(`release ${tag} updated with ${localFiles.join(', ')}`);
} else {
  const args = ['release', 'create', tag, ...assets, '--repo', REPO, '--title', `ChatBox ${version}`, '--target', 'main'];
  const notesIndex = process.argv.indexOf('--notes');
  if (notesIndex !== -1 && process.argv[notesIndex + 1]) {
    args.push('--notes', process.argv[notesIndex + 1]);
  } else {
    args.push('--notes', `ChatBox ${version}`);
  }
  run('gh', args);
  console.log(`release ${tag} published with ${localFiles.join(', ')}`);
}
