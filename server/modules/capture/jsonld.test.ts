import { describe, expect, it } from 'vitest';
import { extractJobPosting } from './jsonld.ts';

const script = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const page = (...scripts: string[]) => `<!doctype html><html><head>${scripts.join('')}</head><body><p>Hi</p></body></html>`;

const seekPosting = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Senior Software Engineer',
  hiringOrganization: { '@type': 'Organization', name: 'Atlassian' },
  jobLocation: {
    '@type': 'Place',
    address: { '@type': 'PostalAddress', addressLocality: 'Sydney', addressRegion: 'NSW', addressCountry: 'AU' },
  },
  employmentType: 'FULL_TIME',
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'AUD',
    value: { '@type': 'QuantitativeValue', minValue: 150000, maxValue: 170000, unitText: 'YEAR' },
  },
  validThrough: '2026-11-30T00:00:00+11:00',
  jobLocationType: 'TELECOMMUTE',
  description: '<p>Build things that matter.</p><ul><li>TypeScript</li><li>Node.js</li></ul>',
};

describe('extractJobPosting', () => {
  it('maps a JobPosting with an AUD salary range', () => {
    const result = extractJobPosting(page(script(seekPosting)));
    expect(result?.structured).toEqual({
      title: 'Senior Software Engineer',
      company: 'Atlassian',
      location: 'Sydney NSW',
      employmentType: 'full-time',
      salary: { min: 150000, max: 170000, currency: 'AUD', period: 'year', text: null },
      closingDate: '2026-11-30',
      workMode: 'remote',
    });
    expect(result?.descriptionText).toContain('Build things that matter.');
    expect(result?.descriptionText?.split('\n')).toEqual(expect.arrayContaining(['• TypeScript', '• Node.js']));
  });

  it('finds a JobPosting inside @graph or with an array @type', () => {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebPage', name: 'Jobs' }, { '@type': ['JobPosting'], title: 'Designer', hiringOrganization: 'Canva' }],
    };
    expect(extractJobPosting(page(script(graph)))?.structured).toMatchObject({ title: 'Designer', company: 'Canva' });
  });

  it('skips script blocks that are not valid JSON', () => {
    const html = page('<script type="application/ld+json">{not json</script>', script({ '@type': 'JobPosting', title: 'Analyst' }));
    expect(extractJobPosting(html)?.structured.title).toBe('Analyst');
  });

  it('returns null when there is no JobPosting', () => {
    expect(extractJobPosting(page(script({ '@type': 'Organization', name: 'Seek' })))).toBeNull();
    expect(extractJobPosting('<html><body>No data</body></html>')).toBeNull();
  });
});
