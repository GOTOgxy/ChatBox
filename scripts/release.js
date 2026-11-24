const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const releaseDir = path.join(ROOT, 'release');
const distDir = path.join(ROOT, 'dist');

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}

run('node', [path.join(ROOT, 'scripts', 'pack-crx.js')]);
fs.copyFileSync(path.join(distDir, 'chatbox-cookie-bridge.crx'), path.join(releaseDir, 'chatbox-cookie-bridge.crx'));
run('node', [path.join(ROOT, 'scripts', 'make-checksums.js')]);

const assets = fs.readdirSync(releaseDir)
  .filter((name) => name === `ChatBox-Setup-${version}.exe` || name === 'chatbox-cookie-bridge.crx' || name === 'checksums.txt')
  .map((name) => path.join(releaseDir, name));

if (!assets.some((asset) => asset.endsWith('.exe'))) {
  console.error(`release/ChatBox-Setup-${version}.exe not found; build it first (electron-builder + ISCC).`);
  process.exit(1);
}

const args = ['release', 'create', `v${version}`, ...assets, '--repo', 'GOTOgxy/ChatBox', '--title', `ChatBox ${version}`, '--target', 'main'];
const notesIndex = process.argv.indexOf('--notes');
if (notesIndex !== -1 && process.argv[notesIndex + 1]) {
  args.push('--notes', process.argv[notesIndex + 1]);
} else {
  args.push('--notes', `ChatBox ${version}`);
}
run('gh', args);
console.log(`release v${version} published with crx + checksums`);
