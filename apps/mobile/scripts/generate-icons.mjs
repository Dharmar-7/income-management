// Generates the Velora brand assets: app icon, Android adaptive icon, splash,
// and a transparent in-app logo (logo-wheel.png used by the header + tab bar).
//
// Brand mark (chosen 2026-06-14): "V from two leaves + seed coin" — two green
// leaves form a V, sprouting from a small silver ₹ seed-coin. Growth + savings,
// with an Indian-rupee cue. (The in-app file keeps the name logo-wheel.png so
// existing imports don't change.)
//
// Run:  npm i -D sharp   (one-off build tool, not an app dependency)
//       node scripts/generate-icons.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');
const FONT = '-apple-system,Segoe UI,Roboto,sans-serif';

// ── shared mark pieces ───────────────────────────────────────────────────────
function milledRing(cx, cy, rO, rI, n, color, op) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    s += `<line x1="${(cx + rO * Math.cos(a)).toFixed(1)}" y1="${(cy + rO * Math.sin(a)).toFixed(1)}" x2="${(cx + rI * Math.cos(a)).toFixed(1)}" y2="${(cy + rI * Math.sin(a)).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-opacity="${op}"/>`;
  }
  return s;
}
function leaf(cx, cy, rot, scale, gid) {
  return `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${scale})">
    <path d="M0 0 C -18 -10,-26 -34,-16 -52 C 4 -42,12 -18,0 0 Z" fill="url(#${gid})"/>
    <path d="M0 -2 C -8 -16,-14 -32,-15 -46" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>
  </g>`;
}

// Solid-white leaf, no gradient/veins — for the Android notification icon, where
// only the alpha silhouette survives (colour is discarded by the OS). `mirror`
// flips it horizontally so a left+right pair is truly symmetric.
function whiteLeaf(cx, cy, rot, scale, mirror = false) {
  const sx = mirror ? -scale : scale;
  return `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${sx} ${scale})">
    <path d="M0 0 C -18 -10,-26 -34,-16 -52 C 4 -42,12 -18,0 0 Z" fill="#ffffff"/>
  </g>`;
}

// The mark, authored in a 200×200 space, then re-centred so its visual middle
// sits at (100,100) for clean placement in any canvas.
function leafMark(u, withShadow) {
  return `<defs>
    <linearGradient id="lf${u}" x1="0" y1="1" x2="0.45" y2="0"><stop offset="0" stop-color="#166534"/><stop offset="1" stop-color="#86efac"/></linearGradient>
    <radialGradient id="seed${u}" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#cbd5e1"/><stop offset="1" stop-color="#64748b"/></radialGradient>
    <filter id="sh${u}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>
  <g transform="translate(0 -31)">
    ${withShadow ? `<ellipse cx="100" cy="184" rx="40" ry="8" fill="#1e1b4b" opacity="0.16" filter="url(#sh${u})"/>` : ''}
    ${leaf(100, 156, -27, 1.7, 'lf' + u)} ${leaf(100, 156, 27, 1.7, 'lf' + u)}
    <circle cx="100" cy="168" r="13" fill="url(#seed${u})"/>${milledRing(100, 168, 13, 9.5, 28, '#64748b', 0.6)}
    <text x="100" y="169" font-family="${FONT}" font-size="13" font-weight="800" fill="#334155" text-anchor="middle" dominant-baseline="central">₹</text>
  </g>`;
}

// scale `s` about the canvas centre (100,100)
function placed(s, body) {
  const a = (100 * (1 - s)).toFixed(3);
  return `<g transform="translate(${a} ${a}) scale(${s})">${body}</g>`;
}

function iconSVG(S, s, withShadow) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 200 200">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ede9fe"/></linearGradient></defs>
  <rect width="200" height="200" fill="url(#bg)"/>
  ${placed(s, leafMark('a', withShadow))}
</svg>`;
}

function transparentSVG(S, s) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 200 200">
  ${placed(s, leafMark('t', false))}
</svg>`;
}

// Android notification small-icon: a bold white "V of two leaves" on a fully
// transparent background, padded to stay inside the 24dp status-bar safe zone.
// Must be white-only — Android tints the silhouette with the notification colour.
function notificationSVG(S) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 200 200">
  ${whiteLeaf(100, 145, -25, 1.9)}
  ${whiteLeaf(100, 145, 25, 1.9, true)}
</svg>`;
}

function splashSVG(W, H) {
  const k = (Math.min(W, H) * 0.46) / 200;
  const tx = (W / 2 - 100 * k).toFixed(2);
  const ty = (H / 2 - 100 * k).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f5f3ff"/>
  <g transform="translate(${tx} ${ty}) scale(${k})">${leafMark('s', true)}</g>
</svg>`;
}

async function render(svg, w, h, outName) {
  await sharp(Buffer.from(svg)).resize(w, h).png().toFile(join(ASSETS, outName));
  console.log(`✓ ${outName}  (${w}×${h})`);
}

await render(iconSVG(1024, 0.86, true), 1024, 1024, 'icon.png');
await render(iconSVG(1024, 0.70, false), 1024, 1024, 'adaptive-icon.png');  // smaller for Android safe zone
await render(splashSVG(1284, 2778), 1284, 2778, 'splash.png');
await render(transparentSVG(512, 1.06), 512, 512, 'logo-wheel.png');         // transparent, in-app
await render(notificationSVG(96), 96, 96, 'notification-icon.png');          // white silhouette, Android notifications

console.log('\nDone. Rebuild the app to see the new icon (icons are baked into the native build).');
