#!/usr/bin/env node
// Renders every icon file the app, the site and the desktop app ship, from the
// one drawing of the mark ("Thread + stations", design sheet f37).
//
//   node scripts/brand-icons.mjs
//
// The SVG strings below are the same geometry as
// apps/client/src/components/brand/Logo.tsx. If the mark changes, change both,
// then run this and commit what it writes.
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLIENT_PUBLIC = path.join(ROOT, 'apps/client/public');
const BRAND = path.join(ROOT, 'brand');

const mark = ({ end = '#ecfdf5', endR = 1.5 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<rect width="32" height="32" rx="9" fill="#10b981"/>` +
  `<path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23" fill="none" stroke="#022c22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M6.5 16H20.5L16 22.5H25" fill="none" stroke="#ecfdf5" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<circle cx="6.5" cy="16" r="2.3" fill="#022c22"/><circle cx="6.5" cy="16" r="1.15" fill="#ecfdf5"/>` +
  `<circle cx="20.5" cy="16" r="2.3" fill="#022c22"/><circle cx="20.5" cy="16" r="1.15" fill="#ecfdf5"/>` +
  `<circle cx="25" cy="22.5" r="2.65" fill="#022c22"/><circle cx="25" cy="22.5" r="${endR}" fill="${end}"/></svg>`;

// Letters only: at 16px the thread and the stations are below a pixel.
const favicon =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#10b981"/>` +
  `<path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25.5L16 22.5H25.5" fill="none" stroke="#022c22" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// A desktop app icon sits in a dock beside other icons that leave a margin
// round their tile; a full-bleed tile looks oversized there. 824 of 1024 is
// the macOS template's content box.
const padded = (svg, size, inner) => {
  const off = (size - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><g transform="translate(${off} ${off}) scale(${inner / 32})">${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;
};

const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log('wrote', path.relative(ROOT, file));
};

const STATES = { running: '#38bdf8', approval: '#fbbf24', failed: '#fb7185' };

write(path.join(CLIENT_PUBLIC, 'favicon.svg'), favicon);
write(path.join(CLIENT_PUBLIC, 'favicon-32.png'), png(mark(), 32));
write(path.join(CLIENT_PUBLIC, 'apple-touch-icon.png'), png(mark(), 180));
write(path.join(CLIENT_PUBLIC, 'icon-192.png'), png(mark(), 192));
write(path.join(CLIENT_PUBLIC, 'icon-512.png'), png(mark(), 512));
for (const [state, end] of Object.entries(STATES)) {
  write(path.join(CLIENT_PUBLIC, `favicon-${state}.svg`), mark({ end, endR: 1.6 }));
}

write(path.join(BRAND, 'mark.svg'), mark());
write(path.join(BRAND, 'favicon.svg'), favicon);
write(path.join(BRAND, 'app-icon-1024.png'), png(padded(mark(), 1024, 824), 1024));
for (const [state, end] of Object.entries(STATES)) {
  write(path.join(BRAND, `tray-${state}.png`), png(mark({ end, endR: 1.6 }), 64));
}
write(path.join(BRAND, 'tray-idle.png'), png(mark(), 64));
