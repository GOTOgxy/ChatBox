const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const releaseDir = path.join(__dirname, '..', 'release');
const files = fs.readdirSync(releaseDir).filter((name) => /^ChatBox-Setup-.*\.exe$/i.test(name));
const lines = files.map((name) => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseDir, name))).digest('hex');
  return `${hash}  ${name}`;
});
fs.writeFileSync(path.join(releaseDir, 'checksums.txt'), lines.join('\n') + '\n');
console.log(`checksums written: ${files.join(', ')}`);
