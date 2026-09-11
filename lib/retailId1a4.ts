import 'server-only';

export type RetailId1A4Record = {
  url: string;
  retailId: string | null;
  serial: string | null;
  title: string | null;
  cultivar: string | null;
  facility: string | null;
  facilityLicense: string | null;
  labName: string | null;
  labLicense: string | null;
  testedAt: string | null;
  coaUrl: string | null;
  thcText: string | null;
  cbdText: string | null;
  pageText: string;
};

const HOSTS = new Set(['app.1a4.com', 'www.app.1a4.com']);

export function isRetailId1A4Url(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && HOSTS.has(url.hostname.toLowerCase()) && /^\/landingpage\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToText(html: string) {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/\s{2,}/g, ' ');
  }
  return null;
}

function absoluteUrl(base: string, candidate: string | null) {
  if (!candidate) return null;
  try { return new URL(candidate, base).toString(); } catch { return null; }
}

function extractCoaUrl(html: string, base: string) {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => decodeEntities(match[1]));
  const likely = hrefs.find(href => /(?:coa|certificate|lab|test).*(?:\.pdf|download)|\.pdf(?:\?|$)/i.test(href));
  return absoluteUrl(base, likely || null);
}

function extractTitle(html: string, text: string) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  if (og && !/retail\s*id/i.test(og)) return decodeEntities(og).trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title && !/retail\s*id/i.test(title)) return decodeEntities(title.replace(/<[^>]+>/g, ' ')).trim();
  return firstMatch(text, [/(?:Product|Item|Product Name)\s*:\s*([^\n]+)/i]);
}

export async function fetchRetailId1A4(value: string): Promise<RetailId1A4Record> {
  if (!isRetailId1A4Url(value)) throw new Error('Unsupported Retail ID URL.');
  const input = new URL(value);
  const response = await fetch(input.toString(), {
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'GeoWeedo/1.0 (+https://geoweedo.com)',
    },
  });
  if (!response.ok) throw new Error(`Retail ID page returned ${response.status}.`);
  const finalUrl = response.url || input.toString();
  const html = await response.text();
  if (!html || html.length > 2_000_000) throw new Error('Retail ID page could not be read safely.');
  const text = htmlToText(html);

  const parts = input.pathname.split('/').filter(Boolean);
  const retailIdFromPath = parts[1] && /^1a4[a-z0-9]+$/i.test(parts[1]) ? parts[1].toUpperCase() : null;
  const serial = parts[2] || null;
  const retailId = firstMatch(text, [
    /(?:Metrc\s*(?:ID|Id)|Retail\s*ID|Id)\s*:\s*(1A4[A-Z0-9]+)/i,
    /\b(1A4[A-Z0-9]{12,})\b/i,
  ]) || retailIdFromPath;

  return {
    url: finalUrl,
    retailId,
    serial,
    title: extractTitle(html, text),
    cultivar: firstMatch(text, [/(?:Cultivar|Strain)\s*:\s*([^\n]+)/i]),
    facility: firstMatch(text, [/(?:Facility|Produced By|Manufactured By|Processor)\s*:\s*([^\n]+)/i]),
    facilityLicense: firstMatch(text, [/(?:Facility License|License)\s*:\s*([A-Z0-9-]+)/i]),
    labName: firstMatch(text, [/(?:Tested By|Lab(?:oratory)?)\s*:\s*([^\n]+)/i]),
    labLicense: firstMatch(text, [/(?:Lab License)\s*:\s*([A-Z0-9-]+)/i]),
    testedAt: firstMatch(text, [/(?:Tested (?:On|Date)|On)\s*:\s*([^\n]+)/i]),
    coaUrl: extractCoaUrl(html, finalUrl),
    thcText: firstMatch(text, [/(?:Total\s+)?THC\s*:?\s*([^\n]+)/i]),
    cbdText: firstMatch(text, [/(?:Total\s+)?CBD\s*:?\s*([^\n]+)/i]),
    pageText: text.slice(0, 12000),
  };
}
