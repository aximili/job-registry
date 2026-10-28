import { describe, expect, it } from 'vitest';
import { mapJobPosting } from './jobposting.ts';

const posting = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Senior Software Engineer',
  hiringOrganization: { '@type': 'Organization', name: 'Atlassian' },
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Sydney', addressRegion: 'NSW' } },
  employmentType: 'FULL_TIME',
  baseSalary: { currency: 'AUD', value: { minValue: 150000, maxValue: 170000, unitText: 'YEAR' } },
  validThrough: '2026-11-30T14:00:00Z',
  description: '<p>Build things.</p>',
};

describe('mapJobPosting', () => {
  it('maps a JobPosting, leaving the description as HTML for the caller to turn into text', () => {
    expect(mapJobPosting(posting)).toEqual({
      structured: {
        title: 'Senior Software Engineer',
        company: 'Atlassian',
        location: 'Sydney NSW',
        employmentType: 'full-time',
        salary: { min: 150000, max: 170000, currency: 'AUD', period: 'year', text: null },
        closingDate: '2026-12-01',
      },
      descriptionHtml: '<p>Build things.</p>',
    });
  });

  it('finds it inside an array or an @graph, and returns null when there is none', () => {
    expect(mapJobPosting([{ '@type': 'WebSite' }, posting])?.structured.title).toBe('Senior Software Engineer');
    expect(mapJobPosting({ '@graph': [{ '@type': 'Organization' }, posting] })?.structured.company).toBe('Atlassian');
    expect(mapJobPosting({ '@type': 'Article' })).toBeNull();
    expect(mapJobPosting('not json data')).toBeNull();
  });
});
