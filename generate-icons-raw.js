#!/usr/bin/env node
// Generates PNG icons without any external dependencies.
// Uses raw PNG encoding (DEFLATE via zlib built-in).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 48, 128];
const ICON_DEFS = [
  { name: 'green', r: 0x2e, g: 0xa0, b: 0x43 },
  { name: 'red',   r: 0xf8, g: 0x51, b: 0x49 },
];

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = u32be(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBytes = u32be(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crcBytes]);
}

function makePNG(size, r, g, b) {
  // Build RGBA pixel array — circle with antialiased edge, letter "G" in white
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 0.5;

  // Render circle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, Math.min(1, radius - dist + 0.5));
      const idx = (y * size + x) * 4;
      pixels[idx]     = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = Math.round(alpha * 255);
    }
  }

  // Render a simple "G" shape using a bitmap approach
  // Scale factor relative to 48px reference
  const scale = size / 48;
  const fSize = Math.max(2, Math.round(22 * scale));
  const ox = Math.round(cx - fSize * 0.30);
  const oy = Math.round(cy - fSize * 0.48);

  function setPixel(px, py, alpha) {
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const idx = (py * size + px) * 4;
    const a = Math.round(alpha * 255);
    if (a > pixels[idx + 3]) return; // only draw on top of circle
    // Blend white over existing
    const bg_a = pixels[idx + 3] / 255;
    const fg_a = (a / 255) * bg_a; // white only inside circle
    pixels[idx]     = Math.min(255, pixels[idx]     + Math.round(fg_a * (255 - pixels[idx])));
    pixels[idx + 1] = Math.min(255, pixels[idx + 1] + Math.round(fg_a * (255 - pixels[idx + 1])));
    pixels[idx + 2] = Math.min(255, pixels[idx + 2] + Math.round(fg_a * (255 - pixels[idx + 2])));
  }

  // Draw "G" as a series of filled rectangles (simplified glyph)
  // Using a 5x7 bitmap for "G"
  const gBitmap = [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,0],
    [1,0,1,1,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,1,1,1],
  ];

  const cellW = Math.max(1, Math.round(fSize / 5));
  const cellH = Math.max(1, Math.round(fSize / 7));
  const gW = cellW * 5;
  const gH = cellH * 7;
  const startX = Math.round(cx - gW / 2);
  const startY = Math.round(cy - gH / 2);

  for (let row = 0; row < gBitmap.length; row++) {
    for (let col = 0; col < gBitmap[row].length; col++) {
      if (gBitmap[row][col]) {
        for (let dy2 = 0; dy2 < cellH; dy2++) {
          for (let dx2 = 0; dx2 < cellW; dx2++) {
            const px = startX + col * cellW + dx2;
            const py = startY + row * cellH + dy2;
            if (px >= 0 && py >= 0 && px < size && py < size) {
              const idx = (py * size + px) * 4;
              if (pixels[idx + 3] > 100) { // only inside circle
                pixels[idx]     = 255;
                pixels[idx + 1] = 255;
                pixels[idx + 2] = 255;
              }
            }
          }
        }
      }
    }
  }

  // Build PNG IDAT scanlines (filter byte 0 = None per row)
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = 1 + x * 4;
      row[di]     = pixels[si];
      row[di + 1] = pixels[si + 1];
      row[di + 2] = pixels[si + 2];
      row[di + 3] = pixels[si + 3];
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData, { level: 6 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

for (const { name, r, g, b } of ICON_DEFS) {
  for (const size of SIZES) {
    const png = makePNG(size, r, g, b);
    const filename = `icon-${name}-${size}.png`;
    fs.writeFileSync(path.join(iconsDir, filename), png);
    console.log(`Created ${filename} (${png.length} bytes)`);
  }
}

console.log('\nAll icons generated in icons/');
