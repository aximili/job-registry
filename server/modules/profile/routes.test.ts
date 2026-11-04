import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.ts';

const STARTER = readFileSync(new URL('../../../starters/profile/cover-letter-guide.md', import.meta.url), 'utf8');

describe('starter guide routes', () => {
  let app: TestApp;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  it("GET /profile/starters gives each guide's state, and isn't taken for a profile file called starters", async () => {
    const res = await app.request('GET', '/api/v1/profile/starters');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: 'resume-guide', state: 'same', diff: null },
      { name: 'cover-letter-guide', state: 'same', diff: null },
    ]);
  });

  it('a changed guide is newer when you have not seen this starter; Keep mine and Use the new guide each take one call', async () => {
    await app.request('PUT', '/api/v1/profile/cover-letter-guide', { text: 'My own guide.\n' });
    // The app copied this starter in at start-up, so you've seen it: no note.
    expect((await app.request('GET', '/api/v1/profile/starters')).body[1]).toEqual({ name: 'cover-letter-guide', state: 'yours', diff: null });
    // An install from before the record was kept.
    rmSync(join(app.root, 'profile', '.starter-versions.json'));
    const newer = await app.request('GET', '/api/v1/profile/starters');
    expect(newer.body[1]).toMatchObject({ name: 'cover-letter-guide', state: 'newer' });
    expect(newer.body[1].diff[0]).toEqual({ kind: 'removed', text: 'My own guide.' });

    const keep = await app.request('POST', '/api/v1/profile/cover-letter-guide/starter', { action: 'keep' });
    expect(keep.status).toBe(200);
    expect(keep.body).toEqual({ name: 'cover-letter-guide', state: 'yours', diff: null });

    const use = await app.request('POST', '/api/v1/profile/cover-letter-guide/starter', { action: 'use' });
    expect(use.status).toBe(200);
    expect(use.body).toEqual({ name: 'cover-letter-guide', text: STARTER, updatedAt: expect.any(String) });
    expect((await app.request('GET', '/api/v1/profile/starters')).body[1]).toEqual({ name: 'cover-letter-guide', state: 'same', diff: null });
    expect(readFileSync(join(app.root, 'profile', 'cover-letter-guide.md'), 'utf8')).toBe(STARTER);
  });

  it('only the dashboard can use or keep a starter', async () => {
    const res = await app.request('POST', '/api/v1/profile/cover-letter-guide/starter', { action: 'use' }, { origin: 'moz-extension://abc' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only the dashboard can change your profile and templates.');
  });

  it("a name that isn't a guide is a 404", async () => {
    for (const name of ['master-profile', 'resume', 'secrets']) {
      const res = await app.request('POST', `/api/v1/profile/${name}/starter`, { action: 'keep' });
      expect(res.status, name).toBe(404);
      expect(res.body.error.message).toBe(`There's no starter guide called ${name}.`);
    }
  });

  it('an action other than use or keep is refused', async () => {
    const res = await app.request('POST', '/api/v1/profile/resume-guide/starter', { action: 'replace' });
    expect(res.status).toBe(400);
  });
});

describe('starter guides at start-up', () => {
  it("the app still starts when a starter guide can't be updated, and the log says so in plain words", async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
    const old = readFileSync(new URL('../../../tests/fixtures/starters/resume-guide.75011e0.md', import.meta.url), 'utf8');
    // A file where the old-versions folder goes, so the old text can't be kept.
    const app = await createTestApp({ logger, files: { 'profile/old-versions': 'not a folder', 'profile/resume-guide.md': old } });
    try {
      expect((await app.request('GET', '/api/v1/profile/resume-guide')).body.text).toBe(old);
      expect((await app.request('GET', '/api/v1/profile/starters')).body[0]).toMatchObject({ name: 'resume-guide', state: 'newer' });
      const said = lines.map((line) => JSON.parse(line) as { msg: string; err?: unknown });
      const warning = said.find((l) => l.msg === "Couldn't add or update the starter file resume-guide. It's left as it was.");
      expect(warning?.err).toBeDefined();
      expect(said.map((l) => l.msg)).toContain('Added starter files: cover-letter-guide, resume, cover-letter');
      expect(said.map((l) => l.msg).some((m) => m.startsWith('Updated the starter guide'))).toBe(false);
    } finally {
      await app.cleanup();
    }
  });

  it('logs the guides it updated', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
    const old = readFileSync(new URL('../../../tests/fixtures/starters/cover-letter-guide.5ac1b81.md', import.meta.url), 'utf8');
    const app = await createTestApp({ logger, files: { 'profile/cover-letter-guide.md': old } });
    try {
      expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toContain('Updated the starter guide: cover-letter-guide');
      expect((await app.request('GET', '/api/v1/profile/cover-letter-guide')).body.text).toBe(STARTER);
    } finally {
      await app.cleanup();
    }
  });
});
