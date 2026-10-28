// npm run ext:sign: signs the Firefox build with your addons.mozilla.org
// account, as an unlisted (private) add-on, so it stays installed in normal
// Firefox. The keys come from the environment and are never stored here. In
// PowerShell (Windows' usual terminal):
//   $env:WEB_EXT_API_KEY = "user:12345:678"
//   $env:WEB_EXT_API_SECRET = "abc…"
//   npm run ext:sign
// The signed .xpi lands in extension\dist\signed\. See extension/README.md.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signingVersion } from './version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  console.error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET first. In PowerShell:');
  console.error('  $env:WEB_EXT_API_KEY = "user:12345:678"');
  console.error('  $env:WEB_EXT_API_SECRET = "your-secret"');
  console.error('See extension/README.md.');
  process.exit(1);
}

// A new version number for each upload (addons.mozilla.org refuses one it has).
const manifestFile = join(here, 'dist', 'firefox', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
manifest.version = signingVersion(manifest.version);
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Signing version ${manifest.version}`);
const webExt = join(here, '..', 'node_modules', 'web-ext', 'bin', 'web-ext.js');
const result = spawnSync(
  process.execPath,
  [webExt, 'sign', '--channel=unlisted', '-s', join(here, 'dist', 'firefox'), '--artifacts-dir', join(here, 'dist', 'signed')],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
