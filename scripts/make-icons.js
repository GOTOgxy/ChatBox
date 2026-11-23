const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

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

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function makePng(size, drawPixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = drawPixel(x, y, size);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function roundedSquarePixel(x, y, size) {
  const radius = size * 0.22;
  const inset = size * 0.04;
  const min = inset;
  const max = size - inset;
  const cx = Math.max(min + radius, Math.min(max - radius, x));
  const cy = Math.max(min + radius, Math.min(max - radius, y));
  const inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 && x >= min && x <= max && y >= min && y <= max;
  if (!inside) return [0, 0, 0, 0];
  const t = y / size;
  return [Math.round(77 + 30 * t), Math.round(107 - 20 * t), 254, 255];
}

function trayPixel(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const dist = Math.hypot(x - cx, y - cy);
  if (dist > size * 0.42) return [0, 0, 0, 0];
  if (dist > size * 0.30) return [255, 255, 255, 255];
  return [255, 255, 255, 90];
}

const assetsDir = path.join(ROOT, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(path.join(assetsDir, 'icon.png'), makePng(256, roundedSquarePixel));
fs.writeFileSync(path.join(assetsDir, 'tray.png'), makePng(32, trayPixel));

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const extDir = path.join(ROOT, 'extension');
fs.mkdirSync(extDir, { recursive: true });
fs.writeFileSync(path.join(extDir, 'key.txt'), publicDer.toString('base64'));
fs.writeFileSync(path.join(assetsDir, 'extension-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));

const hash = crypto.createHash('sha256').update(publicDer).digest();
const extensionId = Array.from(hash.subarray(0, 16))
  .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
  .join('');
console.log(`icons written; extension id: ${extensionId}`);
