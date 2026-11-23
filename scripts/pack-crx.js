const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const KEY_PATH = path.join(ROOT, 'assets', 'extension-private.pem');

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function collectFiles(dir, base = '') {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(full, relative));
    else result.push({ name: relative, data: fs.readFileSync(full) });
  }
  return result;
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_PATH));
const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const zip = zipStore(collectFiles(EXT_DIR));

function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function protoBytes(fieldNumber, payload) {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  return Buffer.concat([tag, encodeVarint(payload.length), payload]);
}

const magic = Buffer.from('CRX3 SignedData\0', 'utf8');

const crxId = crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
const signedHeaderData = protoBytes(1, crxId);
const signedHeaderSize = Buffer.alloc(4);
signedHeaderSize.writeUInt32LE(signedHeaderData.length, 0);
const signedData = Buffer.concat([magic, signedHeaderSize, signedHeaderData, zip]);
const signature = crypto.sign('sha256', signedData, privateKey);
const asymmetricKeyProof = Buffer.concat([
  protoBytes(1, publicKeyDer),
  protoBytes(2, signature)
]);
const crxFileHeader = Buffer.concat([
  protoBytes(2, asymmetricKeyProof),
  protoBytes(10000, signedHeaderData)
]);
const header = Buffer.alloc(12);
header.write('Cr24', 0, 'ascii');
header.writeUInt32LE(3, 4);
header.writeUInt32LE(crxFileHeader.length, 8);
const crx = Buffer.concat([header, crxFileHeader, zip]);

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'chatbox-cookie-bridge.crx');
fs.writeFileSync(outPath, crx);
console.log(`packed: ${outPath} (${fs.statSync(outPath).size} bytes)`);
