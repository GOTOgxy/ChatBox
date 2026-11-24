const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

const THEMES = {
  'purple-pink': { glyph: [[168, 85, 247], [217, 70, 239], [255, 95, 162]], tile: [[28, 22, 38], [18, 15, 28]] },
  'cyan-blue': { glyph: [[34, 211, 238], [59, 130, 246], [99, 102, 241]], tile: [[16, 24, 38], [10, 16, 28]] },
  'amber-orange': { glyph: [[251, 191, 36], [249, 115, 22], [244, 63, 94]], tile: [[34, 24, 18], [24, 16, 12]] },
  'emerald': { glyph: [[52, 211, 153], [16, 185, 129], [45, 212, 191]], tile: [[16, 30, 26], [10, 22, 18]] },
  'mono': { glyph: [[226, 232, 240], [148, 163, 184], [226, 232, 240]], tile: [[24, 24, 28], [14, 14, 18]] }
};

let activeTheme = THEMES['purple-pink'];

function gradientColor(t) {
  const stops = activeTheme.glyph;
  const clamped = Math.max(0, Math.min(1, t));
  const segment = clamped < 0.5 ? 0 : 1;
  const local = (clamped - segment * 0.5) * 2;
  const from = stops[segment];
  const to = stops[segment + 1];
  return [lerp(from[0], to[0], local), lerp(from[1], to[1], local), lerp(from[2], to[2], local)];
}

function roundedSquareMask(x, y, size, insetRatio, radiusRatio) {
  const radius = size * radiusRatio;
  const min = size * insetRatio;
  const max = size - min;
  const cx = Math.max(min + radius, Math.min(max - radius, x));
  const cy = Math.max(min + radius, Math.min(max - radius, y));
  return x >= min && x <= max && y >= min && y <= max && (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function darkTilePixel(x, y, size, insetRatio, radiusRatio) {
  if (!roundedSquareMask(x, y, size, insetRatio, radiusRatio)) return [0, 0, 0, 0];
  const t = y / size;
  const [top, bottom] = activeTheme.tile;
  return [lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t), 255];
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function boxGlyph(u, v, scale) {
  const cx = 0.5;
  const cy = 0.5;
  const w = 0.30 * scale;
  const h = 0.17 * scale;
  const d = 0.26 * scale;
  const stroke = 0.048 * scale;
  const T = [cx, cy - d / 2 - h];
  const R = [cx + w, cy - d / 2];
  const F = [cx, cy - d / 2 + h];
  const L = [cx - w, cy - d / 2];
  const B = [cx, cy + d / 2 + h];
  const BR = [cx + w, cy + d / 2];
  const BL = [cx - w, cy + d / 2];
  const edges = [
    [T, R], [R, F], [F, L], [L, T],
    [F, B], [R, BR], [L, BL],
    [BR, B], [BL, B]
  ];
  let minDist = Infinity;
  for (const [a, b] of edges) {
    minDist = Math.min(minDist, segmentDistance(u, v, a[0], a[1], b[0], b[1]));
  }
  if (minDist <= stroke) {
    const t = Math.max(0, Math.min(1, (v - (cy - d / 2 - h)) / (d + 2 * h)));
    return gradientColor(t);
  }
  return null;
}

function appIconPixel(x, y, size) {
  const tile = darkTilePixel(x, y, size, 0.03, 0.22);
  if (tile[3] === 0) return tile;
  const glyph = boxGlyph(x / size, y / size, 1);
  return glyph ? [...glyph, 255] : tile;
}

function trayIconPixel(x, y, size) {
  const tile = darkTilePixel(x, y, size, 0.06, 0.24);
  if (tile[3] === 0) return tile;
  const glyph = boxGlyph(x / size, y / size, 1.12);
  return glyph ? [...glyph, 255] : tile;
}

function pngToIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  for (const { size, data } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngBuffers.map((item) => item.data)]);
}

const assetsDir = path.join(ROOT, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

function writeTheme(name, outDir, suffix) {
  activeTheme = THEMES[name];
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `icon${suffix}.png`), makePng(1024, appIconPixel));
  fs.writeFileSync(path.join(outDir, `tray${suffix}.png`), makePng(32, trayIconPixel));
  fs.writeFileSync(path.join(outDir, `tray${suffix}@2x.png`), makePng(64, trayIconPixel));
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const ico = pngToIco(icoSizes.map((size) => ({ size, data: makePng(size, appIconPixel) })));
  fs.writeFileSync(path.join(outDir, `icon${suffix}.ico`), ico);
}

const themeArg = process.argv[2];
if (themeArg === 'all') {
  const previewDir = path.join(assetsDir, 'icon-themes');
  for (const name of Object.keys(THEMES)) {
    writeTheme(name, previewDir, `-${name}`);
  }
  console.log(`theme previews written to assets/icon-themes/: ${Object.keys(THEMES).join(', ')}`);
} else {
  const name = THEMES[themeArg] ? themeArg : 'purple-pink';
  writeTheme(name, assetsDir, '');
  console.log(`app icons written (theme: ${name}): icon.png / icon.ico / tray.png / tray@2x.png`);
}
