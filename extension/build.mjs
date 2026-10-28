// Builds the extension for Firefox and Chrome:
//   node extension/build.mjs                into extension/dist/{firefox,chrome}
//   node extension/build.mjs --e2e          also extension/dist/chrome-e2e, for the browser tests
//   node extension/build.mjs --out DIR      somewhere else (the build test uses this)
// The two browsers share everything except a few manifest lines.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const out = arg('out') ?? join(here, 'dist');
const e2e = process.argv.includes('--e2e');

// The browser tests serve copies of the job sites here, and run the app on 4799.
const E2E_SITES = 'http://127.0.0.1:4798';
const E2E_SERVER = 'http://127.0.0.1:4799';

const ENTRIES = {
  background: 'src/background.ts',
  content: 'src/content.ts',
  generic: 'src/sites/generic-entry.ts',
  popup: 'src/popup/main.ts',
  options: 'src/options/main.ts',
};

const readJson = (file) => JSON.parse(readFileSync(join(here, file), 'utf8'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

function manifestFor(browser, forTests) {
  const m = { ...readJson('manifest.base.json'), ...readJson(`manifest.${browser}.json`), version };
  if (forTests) {
    m.host_permissions = [...m.host_permissions, `${E2E_SITES}/*`];
    m.content_scripts = m.content_scripts.map((c) => ({ ...c, matches: [...c.matches, `${E2E_SITES}/*`] }));
  }
  return m;
}

async function buildFor(browser, dir, forTests) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'icons'), { recursive: true });
  await build({
    absWorkingDir: here,
    entryPoints: ENTRIES,
    outdir: dir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: browser === 'firefox' ? 'firefox140' : 'chrome120',
    conditions: ['svelte', 'browser'],
    mainFields: ['svelte', 'browser', 'module', 'main'],
    plugins: [sveltePlugin({ compilerOptions: { css: 'injected' } })],
    define: {
      __E2E_SITES__: forTests ? JSON.stringify(E2E_SITES) : 'undefined',
      __DEFAULT_SERVER__: forTests ? JSON.stringify(E2E_SERVER) : 'undefined',
      __PANEL_SHADOW__: forTests ? JSON.stringify('open') : 'undefined',
    },
    legalComments: 'none',
    logLevel: 'warning',
  });
  copyFileSync(join(here, 'src/popup/popup.html'), join(dir, 'popup.html'));
  copyFileSync(join(here, 'src/options/options.html'), join(dir, 'options.html'));
  for (const size of [16, 32, 48, 128]) writeFileSync(join(dir, 'icons', `${size}.png`), icon(size));
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifestFor(browser, forTests), null, 2)}\n`);
}

await buildFor('firefox', join(out, 'firefox'), false);
await buildFor('chrome', join(out, 'chrome'), false);
if (e2e) await buildFor('chrome', join(out, 'chrome-e2e'), true);
console.log(`Built the extension into ${out}`);

// --- The icon: a white "J" on an ultramarine circle, drawn as a PNG. ---

function icon(size) {
  const samples = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let disc = 0;
      let mark = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          if ((u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.48 ** 2) disc++;
          if (inJ(u, v)) mark++;
        }
      }
      const n = samples * samples;
      const a = disc / n;
      const w = Math.min(mark, disc) / n;
      const i = (y * size + x) * 4;
      // Mix white over the blue (#2b44d1) by how much of the pixel the J covers.
      const t = a > 0 ? w / a : 0;
      px[i] = Math.round(0x2b + (255 - 0x2b) * t);
      px[i + 1] = Math.round(0x44 + (255 - 0x44) * t);
      px[i + 2] = Math.round(0xd1 + (255 - 0xd1) * t);
      px[i + 3] = Math.round(255 * a);
    }
  }
  return png(size, px);
}

function inJ(u, v) {
  const top = v >= 0.22 && v <= 0.33 && u >= 0.36 && u <= 0.72;
  const stem = u >= 0.56 && u <= 0.69 && v >= 0.22 && v <= 0.62;
  const d = Math.hypot(u - 0.47, v - 0.62);
  const hook = v >= 0.62 && d >= 0.09 && d <= 0.22 && u <= 0.69;
  return top || stem || hook;
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
