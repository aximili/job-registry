import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAGE_CSP } from '../../../../shared/document-page.ts';
import { pastedCapture } from '../../../../tests/helpers/jobs.ts';
import { createTestApp, type TestApp } from '../../../../tests/helpers/test-app.ts';
import { unzip } from '../../../../tests/helpers/unzip.ts';
import { createDocxExporter } from './docx.ts';
import { createPrintHtmlExporter } from './print-html.ts';

let app: TestApp;
let jobA: number;
let jobB: number;

function saveJob(title: string, company: string | undefined): number {
  const saved = app.services.jobs.save({ capture: pastedCapture(`${title} ad`), fields: { title, ...(company ? { company } : {}) } });
  if (saved.result !== 'created') throw new Error('setup failed');
  return saved.job.id;
}

beforeEach(async () => {
  app = await createTestApp();
  jobA = saveJob('Senior Engineer', 'Atlassian');
  jobB = saveJob('Platform Engineer', 'Canva');
  await app.services.enrich.onIdle();
  app.services.profile.write('master-profile', '# Sam Taylor\nSenior engineer.');
});
afterEach(async () => {
  await app.cleanup();
});

const RESUME = '# Sam Taylor\n\n## Experience\n\n- Led the **TypeScript** move\n- Wrote [docs](https://example.com)\n\n<script>alert(1)</script>';

describe('the print view', () => {
  it("keeps each job's sent resume exactly as sent after resume.css changes (the Phase 4 done criterion)", async () => {
    const docs = app.services.documents;
    app.services.profile.write('resume', 'h1 { color: navy; }');
    const a = docs.markSent(docs.saveVersion(jobA, { kind: 'resume', markdown: '# A', origin: 'edited' }).id);
    app.services.profile.write('resume', 'h1 { color: green; }');
    const b = docs.markSent(docs.saveVersion(jobB, { kind: 'resume', markdown: '# B', origin: 'edited' }).id);
    const unsent = docs.saveVersion(jobB, { kind: 'resume', markdown: '# B v2', origin: 'edited' });

    app.services.profile.write('resume', 'h1 { color: red; }');
    const pageA = (await app.request('GET', `/api/v1/documents/${a.id}/render`)).body as string;
    const pageB = (await app.request('GET', `/api/v1/documents/${b.id}/render`)).body as string;
    expect(pageA).toContain('h1 { color: navy; }');
    expect(pageB).toContain('h1 { color: green; }');
    for (const page of [pageA, pageB]) expect(page).not.toContain('color: red');
    expect((await app.request('GET', `/api/v1/documents/${unsent.id}/render`)).body).toContain('h1 { color: red; }');
  });

  it('is an HTML page with a strict content security policy, and escapes HTML in the Markdown', async () => {
    const doc = app.services.documents.saveVersion(jobA, { kind: 'resume', markdown: RESUME, origin: 'edited' });
    const res = await app.request('GET', `/api/v1/documents/${doc.id}/render`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toBe(PAGE_CSP);
    expect(res.body).not.toMatch(/<script/i);
    expect(res.body).toContain('&lt;script&gt;');
    expect(res.body).toContain('<title>Sam Taylor – Resume – Atlassian</title>');
  });

  it('titles a cover letter, and leaves out a company that is unknown', async () => {
    const job = saveJob('Analyst', undefined);
    const doc = app.services.documents.saveVersion(job, { kind: 'cover_letter', markdown: 'Dear Hiring Manager,', origin: 'edited' });
    expect(app.services.documents.render(doc.id).title).toBe('Sam Taylor – Cover letter');
    app.services.profile.write('master-profile', 'No heading here.');
    expect(app.services.documents.render(doc.id).title).toBe('Cover letter');
  });
});

describe('exporters', () => {
  it('lists one button per exporter', async () => {
    expect((await app.request('GET', '/api/v1/documents/exporters')).body).toEqual([
      { id: 'print-html', label: 'Save as HTML' },
      { id: 'docx', label: 'Export .docx' },
    ]);
  });

  it('exports a .docx: a Word file with the headings, bullets, Calibri and an A4 page', async () => {
    const doc = app.services.documents.saveVersion(jobA, { kind: 'resume', markdown: RESUME, origin: 'edited' });
    const res = await app.http.inject({
      method: 'GET',
      url: `/api/v1/documents/${doc.id}/export?format=docx`,
      headers: { host: '127.0.0.1:4777' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Sam Taylor - Resume - Atlassian.docx"; filename*=UTF-8''Sam%20Taylor%20%E2%80%93%20Resume%20%E2%80%93%20Atlassian.docx`,
    );
    const files = unzip(res.rawPayload);
    const xml = files.get('word/document.xml')!.toString('utf8');
    expect(xml).toContain('Sam Taylor');
    expect(xml).toContain('Experience');
    expect(xml).toContain('TypeScript');
    expect(xml).toContain('w:w="11906"');
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(xml).not.toContain('<script');
    expect(files.get('word/styles.xml')!.toString('utf8')).toContain('Calibri');
  });

  it('refuses an export it does not have', async () => {
    const doc = app.services.documents.saveVersion(jobA, { kind: 'resume', markdown: '# Sam', origin: 'edited' });
    const res = await app.request('GET', `/api/v1/documents/${doc.id}/export?format=pdf`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("There's no export called pdf.");
  });

  it('Save as HTML gives the print page as a file', async () => {
    const out = await createPrintHtmlExporter().export({ title: 'Sam – Resume', markdown: '# Sam', css: 'h1{}' });
    expect(out).toMatchObject({ contentType: 'text/html; charset=utf-8', fileName: 'Sam – Resume.html' });
    expect(String(out.body)).toContain('<h1>Sam</h1>');
  });

  it('the .docx keeps numbered lists, italics and line breaks', async () => {
    const out = await createDocxExporter().export({ title: 'x', markdown: '1. First\n2. _Second_\n\nLine one\nLine two', css: '' });
    const xml = unzip(out.body as Buffer).get('word/document.xml')!.toString('utf8');
    expect(xml).toContain('First');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('<w:numPr>');
  });
});
