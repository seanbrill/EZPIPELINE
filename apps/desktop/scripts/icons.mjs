// Draws the app icon and the tray icons from the logo (design sheet f37, f152).
// Run by `npm run icons`; the PNGs are committed, so a build does not need this.
//
//   build/icon.png                 1024px app icon; electron-builder makes .icns and .ico from it
//   electron/icons/tray-*.png      22px and @2x 44px, one per state the tray shows
//
// Idle and stopped are template images on a Mac (black, which macOS tints to the menu bar);
// running, waiting and failed carry colour, so they stand out where they should.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const { Resvg } = createRequire(join(app, "../../package.json"))("@resvg/resvg-js");

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();

// The mark, exactly as the logo (f37).
const MARK = `<rect width="32" height="32" rx="9" fill="#10b981"/><path d="M12.5 9.5H6.5V22.5H12.5M6.5 16H20.5M16 9.5H25L16 22.5H23" fill="none" stroke="#022c22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 16H20.5L16 22.5H25" fill="none" stroke="#ecfdf5" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="16" r="2.3" fill="#022c22"/><circle cx="6.5" cy="16" r="1.15" fill="#ecfdf5"/><circle cx="20.5" cy="16" r="2.3" fill="#022c22"/><circle cx="20.5" cy="16" r="1.15" fill="#ecfdf5"/><circle cx="25" cy="22.5" r="2.65" fill="#022c22"/><circle cx="25" cy="22.5" r="1.5" fill="#ecfdf5"/>`;

// App icon: the mark with the margin macOS leaves round an icon (~10% each side).
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(100 100) scale(25.75)">${MARK}</g></svg>`;
writeFileSync(join(app, "build/icon.png"), png(icon, 1024));

// Tray: the E-Z path inside a ring. The ring fills as a run's steps finish.
const C = 2 * Math.PI * 8;
function tray({ ring = "#8e8e93", arc = null, frac = 0, ink = "#8e8e93", dot = null, template = false }) {
  const k = template ? "#000" : null;
  const arcEl = arc && frac > 0 ? `<circle cx="11" cy="11" r="8" fill="none" stroke="${arc}" stroke-width="2" stroke-dasharray="${(C * frac).toFixed(2)} ${C.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 11 11)"/>` : "";
  const dotEl = dot ? `<circle cx="17.5" cy="4.5" r="3.6" fill="${dot}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="none" stroke="${k ?? ring}" stroke-opacity="${template ? 0.45 : 0.55}" stroke-width="2"/>${arcEl}<path d="M8.6 7.6H6.6V14.4H8.6M6.6 11H13.4L11.4 14.4H15.4M11.1 7.6H15.4" fill="none" stroke="${k ?? ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>${dotEl}</svg>`;
}
const states = {
  idle: tray({ template: true }),
  stopped: tray({ template: true, ink: "#000" }).replace('stroke-width="1.6"', 'stroke-width="1.6" stroke-opacity="0.4"'),
  wait: tray({ dot: "#fbbf24" }),
  fail: tray({ dot: "#fb7185", ring: "#fb7185" }),
};
for (let i = 0; i <= 8; i++) states[`run-${i}`] = tray({ arc: "#38bdf8", frac: Math.max(i, 0.4) / 8 });
for (const [name, svg] of Object.entries(states)) {
  writeFileSync(join(app, `electron/icons/tray-${name}.png`), png(svg, 22));
  writeFileSync(join(app, `electron/icons/tray-${name}@2x.png`), png(svg, 44));
}
// The small dot Windows puts over the taskbar button.
for (const [name, fill] of [["wait", "#fbbf24"], ["fail", "#fb7185"]]) {
  writeFileSync(join(app, `electron/icons/overlay-${name}.png`), png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="${fill}" stroke="#09090b" stroke-width="1.5"/></svg>`, 32));
}
console.log(`icons: build/icon.png and ${Object.keys(states).length} tray states`);
