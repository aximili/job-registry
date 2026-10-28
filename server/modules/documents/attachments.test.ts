import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pastedCapture } from '../../../tests/helpers/jobs.ts';
import { createTestApp, TEST_ORIGIN, TEST_PORT, type TestApp } from '../../../tests/helpers/test-app.ts';

let app: TestApp;
let jobId: number;
let events: [string, unknown][];

beforeEach(async () => {
  app = await createTestApp();
  const saved = app.services.jobs.save({ capture: pastedCapture('An ad.'), fields: { title: 'Engineer', company: 'Atlassian' } });
  if (saved.result !== 'created') throw new Error('setup failed');
  jobId = saved.job.id;
  await app.services.enrich.onIdle();
  events = [];
  app.bus.onAny((name, payload) => {
    if (name === 'attachment.added') events.push([name, payload]);
  });
});
afterEach(async () => {
  await app.cleanup();
});

const PDF = Buffer.from('%PDF-1.4\n% a tiny test file\n');

function upload(fileName: string, data: Buffer, opts: { kind?: string; job?: number; origin?: string } = {}) {
  const boundary = '----jr-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    'utf8',
  );
  const payload = Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return app.http.inject({
    method: 'POST',
    url: `/api/v1/jobs/${opts.job ?? jobId}/attachments?kind=${opts.kind ?? 'resume'}`,
    payload,
    headers: {
      host: `127.0.0.1:${TEST_PORT}`,
      origin: opts.origin ?? TEST_ORIGIN,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  });
}

const filesDir = () => join(app.root, 'data', 'files');

function storedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else out.push(relative(filesDir(), join(dir, e.name)).split('\\').join('/'));
    }
  };
  walk(filesDir());
  return out;
}

describe('attachments', () => {
  it('upload, list and download the same bytes, as a download', async () => {
    const res = await upload('cv.pdf', PDF);
    expect(res.statusCode).toBe(201);
    const attachment = res.json();
    expect(attachment).toMatchObject({ jobId, kind: 'resume', fileName: 'cv.pdf', sizeBytes: PDF.length });
    expect(events).toEqual([['attachment.added', { jobId, attachmentId: attachment.id }]]);
    expect(app.services.documents.listAttachments(jobId)).toEqual([attachment]);
    expect(storedFiles()).toEqual([expect.stringMatching(new RegExp(`^${jobId}/[0-9a-f]{8}-cv\\.pdf$`))]);

    const got = await app.http.inject({ method: 'GET', url: `/api/v1/attachments/${attachment.id}`, headers: { host: `127.0.0.1:${TEST_PORT}` } });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PDF)).toBe(true);
    expect(got.headers['content-type']).toBe('application/pdf');
    expect(got.headers['content-disposition']).toBe(`attachment; filename="cv.pdf"; filename*=UTF-8''cv.pdf`);
  });

  it('refuses a file over 15 MB, and keeps nothing', async () => {
    const res = await upload('big.pdf', Buffer.alloc(16 * 1024 * 1024, 1));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('That file is over 15 MB.');
    expect(storedFiles()).toEqual([]);
    expect(app.services.documents.listAttachments(jobId)).toEqual([]);
  });

  it('refuses a file that is not a PDF, Word or text file', async () => {
    const res = await upload('../../evil.exe', Buffer.from('MZ'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Attach a PDF, Word or text file.');
    expect(storedFiles()).toEqual([]);
  });

  it("keeps a file inside its job's folder whatever its name says, and cleans the name", async () => {
    expect((await upload('..\\..\\cv.pdf', PDF)).json().fileName).toBe('cv.pdf');
    expect((await upload('CON.pdf', PDF)).json().fileName).toBe('_CON.pdf');
    expect((await upload('🚀 résumé.pdf', PDF)).json().fileName).toBe('🚀 résumé.pdf');
    const long = (await upload(`${'a'.repeat(300)}.pdf`, PDF)).json().fileName as string;
    expect(long).toHaveLength(100);
    for (const path of storedFiles()) expect(path.startsWith(`${jobId}/`)).toBe(true);
  });

  it('an upload to a job that is not there is a 404, and nothing is written', async () => {
    const res = await upload('cv.pdf', PDF, { job: 999 });
    expect(res.statusCode).toBe(404);
    expect(storedFiles()).toEqual([]);
  });

  it('refuses a request with no file, and an unknown kind', async () => {
    const none = await app.http.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/attachments?kind=resume`,
      payload: '--b\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n--b--\r\n',
      headers: { host: `127.0.0.1:${TEST_PORT}`, origin: TEST_ORIGIN, 'content-type': 'multipart/form-data; boundary=b' },
    });
    expect(none.statusCode).toBe(400);
    expect((await upload('cv.pdf', PDF, { kind: 'poem' })).statusCode).toBe(400);
  });

  it('the browser extension may attach too, as it may save jobs', async () => {
    expect((await upload('cv.pdf', PDF, { origin: 'moz-extension://abc' })).statusCode).toBe(201);
  });

  it('a download of an attachment that is not there is a 404', async () => {
    expect((await app.request('GET', '/api/v1/attachments/999')).status).toBe(404);
  });

  it('stores the file under data/files, in a folder per job', async () => {
    const res = (await upload('letter.docx', Buffer.from('PK fake'), { kind: 'cover_letter' })).json();
    const [path] = storedFiles();
    expect(readFileSync(join(filesDir(), path!), 'utf8')).toBe('PK fake');
    expect(res.kind).toBe('cover_letter');
  });
});
