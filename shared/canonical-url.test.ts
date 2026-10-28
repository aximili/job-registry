import { describe, expect, it } from 'vitest';
import { canonicalJobUrl } from './canonical-url.ts';

const seek = { canonicalUrl: 'https://www.seek.com.au/job/81234567', sourceSite: 'seek', externalId: '81234567' };
const linkedin = {
  canonicalUrl: 'https://www.linkedin.com/jobs/view/4012345678/',
  sourceSite: 'linkedin',
  externalId: '4012345678',
};
const indeed = {
  canonicalUrl: 'https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718',
  sourceSite: 'indeed',
  externalId: 'a1b2c3d4e5f60718',
};

describe('canonicalJobUrl', () => {
  it.each([
    ['https://www.seek.com.au/job/81234567?type=standard&ref=search', seek],
    ['https://www.seek.com.au/software-engineer-jobs/in-All-Sydney-NSW?jobId=81234567&type=standard', seek],
    ['https://seek.com.au/job/81234567', seek],
    [
      'https://www.seek.co.nz/job/123',
      { canonicalUrl: 'https://www.seek.co.nz/job/123', sourceSite: 'seek', externalId: '123' },
    ],
    ['https://www.linkedin.com/jobs/view/4012345678/?trk=abc', linkedin],
    ['https://au.linkedin.com/jobs/view/senior-engineer-at-atlassian-4012345678', linkedin],
    ['https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer', linkedin],
    ['https://au.indeed.com/viewjob?jk=a1b2c3d4e5f60718&from=serp', indeed],
    ['https://au.indeed.com/jobs?q=engineer&l=Sydney&vjk=a1b2c3d4e5f60718', indeed],
    [
      'https://Careers.Example.com/Jobs/123/?utm_source=x&b=2&a=1&gclid=z#apply',
      { canonicalUrl: 'https://careers.example.com/Jobs/123?a=1&b=2', sourceSite: 'other', externalId: null },
    ],
  ])('%s', (input, expected) => {
    expect(canonicalJobUrl(input)).toEqual(expected);
  });

  it('throws on something that is not a URL', () => {
    expect(() => canonicalJobUrl('not a url')).toThrow('Invalid URL');
  });
});
