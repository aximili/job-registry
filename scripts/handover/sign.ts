// Handover step: signs the Firefox extension with your addons.mozilla.org
// keys (WEB_EXT_API_KEY and WEB_EXT_API_SECRET), if you set them. Without
// them it only says so. The signed .xpi lands in extension\dist\signed\.
//
//   node scripts\handover\sign.ts

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createReport, REAL_ROOT, runCommand } from './lib.ts';

const report = createReport('sign');
if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  report.info('not signed', 'no addons.mozilla.org keys');
  process.exit(report.finish());
}
const res = runCommand('npm run ext:sign', REAL_ROOT, 1_800_000);
const signed = join(REAL_ROOT, 'extension', 'dist', 'signed');
const xpi = existsSync(signed) ? readdirSync(signed).filter((f) => f.endsWith('.xpi')) : [];
if (res.status === 0 && xpi.length > 0) report.pass('the extension is signed', join(signed, xpi.at(-1)!));
else report.fail('the extension is signed', `exit code ${res.status ?? 'timed out'}: ${`${res.stdout}${res.stderr}`.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
process.exit(report.finish());
