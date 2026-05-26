#!/usr/bin/env node
// Run with: node generate-icons.js
// Requires: npm install canvas

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 48, 128];
const COLORS = {
  green: '#2ea043',
  red: '#f85149',
};

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

for (const [colorName, fillColor] of Object.entries(COLORS)) {
  for (const size of SIZES) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background circle
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    // "G" text or octopus symbol
    ctx.fillStyle = '#ffffff';
    const fontSize = Math.round(size * 0.55);
    ctx.font = `bold ${fontSize}px system-ui, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('G', size / 2, size / 2 + size * 0.04);

    const filename = `icon-${colorName}-${size}.png`;
    const filepath = path.join(iconsDir, filename);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filepath, buffer);
    console.log(`Created ${filename}`);
  }
}

console.log('\nAll icons generated in icons/ folder.');
