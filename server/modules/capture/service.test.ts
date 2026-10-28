import { describe, expect, it } from 'vitest';
import { createCaptureService } from './service.ts';

const now = () => new Date('2026-10-28T03:15:00.000Z');

function fetchReturning(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status, headers: { 'content-type': 'text/html' } })) as typeof fetch;
}

const longParagraph =
  'We are looking for a thoughtful engineer to join our platform team in Sydney. ' +
  'You will design, build and run services used by millions of people, work closely with product ' +
  'and design, and help shape how we build software. ';

describe('capture service', () => {
  it('fromText normalises messy pasted text but keeps all of it', () => {
    const service = createCaptureService({ now });
    const messy = 'Senior Engineer 🚀  \r\nAtlassian\r\n\r\n\r\n\r\nAbout the role   \r\n';
    const capture = service.fromText(messy);
    expect(capture.jdText).toBe('Senior Engineer 🚀\nAtlassian\n\nAbout the role');
    expect(capture).toMatchObject({
      sourceSite: 'pasted',
      sourceUrl: null,
      canonicalUrl: null,
      externalId: null,
      capturedAt: '2026-10-28T03:15:00.000Z',
    });

    const huge = 'x'.repeat(60_000);
    expect(service.fromText(huge).jdText).toHaveLength(60_000);
  });

  it('fromUrl uses JobPosting data and the description as the ad text', async () => {
    const html = `<html><head><title>Job</title><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Platform Engineer',
      hiringOrganization: { name: 'Canva' },
      description: `<p>${longParagraph}</p>`,
    })}</script></head><body></body></html>`;
    const service = createCaptureService({ now, fetch: fetchReturning(200, html) });
    const { capture, warning } = await service.fromUrl('https://www.seek.com.au/job/81234567?ref=x');
    expect(warning).toBeNull();
    expect(capture).toMatchObject({
      sourceUrl: 'https://www.seek.com.au/job/81234567?ref=x',
      canonicalUrl: 'https://www.seek.com.au/job/81234567',
      sourceSite: 'seek',
      externalId: '81234567',
      title: 'Platform Engineer',
      company: 'Canva',
    });
    expect(capture.structured?.title).toBe('Platform Engineer');
    expect(capture.jdText).toContain('thoughtful engineer');
  });

  it('fromUrl falls back to readable page text when there is no JobPosting', async () => {
    const html = `<html><head><title>Data Analyst – Acme</title></head><body><nav>Home</nav>
      <article><h1>Data Analyst</h1><p>${longParagraph}</p><p>${longParagraph}</p></article></body></html>`;
    const service = createCaptureService({ now, fetch: fetchReturning(200, html) });
    const { capture, warning } = await service.fromUrl('https://careers.example.com/jobs/12');
    expect(warning).toBeNull();
    expect(capture.sourceSite).toBe('other');
    expect(capture.jdText).toContain('thoughtful engineer');
  });

  it('fromUrl explains a blocked site', async () => {
    const seekBlocked = createCaptureService({ now, fetch: fetchReturning(403, 'Forbidden') });
    const seek = await seekBlocked.fromUrl('https://www.seek.com.au/job/81234567');
    expect(seek.capture.jdText).toBe('');
    expect(seek.capture.canonicalUrl).toBe('https://www.seek.com.au/job/81234567');
    expect(seek.warning).toBe(
      "Seek didn't let the app download this page. Copy the ad text from your browser and paste it here instead.",
    );

    const other = await seekBlocked.fromUrl('https://careers.example.com/jobs/12');
    expect(other.warning).toMatch(/^That site didn't let the app download this page\./);

    const throwing = createCaptureService({
      now,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    expect((await throwing.fromUrl('https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718')).warning).toMatch(/^Indeed didn't/);

    const tiny = createCaptureService({ now, fetch: fetchReturning(200, '<html><body>Please verify you are human</body></html>') });
    expect((await tiny.fromUrl('https://www.linkedin.com/jobs/view/4012345678/')).warning).toMatch(/^LinkedIn didn't/);
  });
});
