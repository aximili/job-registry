// Turns any link to a job ad into one stable form, so the same ad is
// recognised whether you saved it from a search page, a share link or
// the ad itself.

export type CanonicalSite = 'seek' | 'linkedin' | 'indeed' | 'other';

export type CanonicalJobUrl = {
  canonicalUrl: string;
  sourceSite: CanonicalSite;
  externalId: string | null;
};

const TRACKING_PARAM = /^(utm_.+|gclid|fbclid|mc_cid|mc_eid)$/i;

// Seek's older addresses and its newer ones (au.seek.com, nz.seek.com). A
// Seek job always gets the older form, so a job saved from either address is
// the same job.
const SEEK_HOSTS = new Map([
  ['seek.com.au', 'com.au'],
  ['seek.co.nz', 'co.nz'],
  ['au.seek.com', 'com.au'],
  ['nz.seek.com', 'co.nz'],
]);

export function canonicalJobUrl(input: string): CanonicalJobUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid URL');

  const host = url.hostname.toLowerCase();

  const seekCountry = SEEK_HOSTS.get(host.replace(/^www\./, ''));
  if (seekCountry) {
    const id = url.pathname.match(/^\/job\/(\d+)/)?.[1] ?? digitsOnly(url.searchParams.get('jobId'));
    if (id) return { canonicalUrl: `https://www.seek.${seekCountry}/job/${id}`, sourceSite: 'seek', externalId: id };
    return { canonicalUrl: genericUrl(url, host), sourceSite: 'seek', externalId: null };
  }

  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const id =
      // /comm/ is the form job-alert emails link to.
      url.pathname.match(/^\/(?:comm\/)?jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1] ??
      digitsOnly(url.searchParams.get('currentJobId'));
    if (id) {
      return { canonicalUrl: `https://www.linkedin.com/jobs/view/${id}/`, sourceSite: 'linkedin', externalId: id };
    }
    return { canonicalUrl: genericUrl(url, host), sourceSite: 'linkedin', externalId: null };
  }

  if (host === 'indeed.com' || host.endsWith('.indeed.com')) {
    const id = [url.searchParams.get('jk'), url.searchParams.get('vjk')].find(
      (v): v is string => v !== null && /^[0-9a-f]{16}$/i.test(v),
    );
    if (id) {
      const jk = id.toLowerCase();
      return { canonicalUrl: `https://${host}/viewjob?jk=${jk}`, sourceSite: 'indeed', externalId: jk };
    }
    return { canonicalUrl: genericUrl(url, host), sourceSite: 'indeed', externalId: null };
  }

  return { canonicalUrl: genericUrl(url, host), sourceSite: 'other', externalId: null };
}

function digitsOnly(value: string | null): string | null {
  return value !== null && /^\d+$/.test(value) ? value : null;
}

// Lower-case host, no hash, no tracking parameters, sorted parameters,
// no trailing slash.
function genericUrl(url: URL, host: string): string {
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${host}${port}${path}${query}`;
}
