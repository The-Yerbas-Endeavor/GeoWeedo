#!/usr/bin/env node

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/probe-retail-id-page.mjs <https://app.1a4.com/landingpage/...>');
  process.exit(2);
}

let pageUrl;
try {
  pageUrl = new URL(input);
} catch {
  console.error('Invalid URL.');
  process.exit(2);
}

if (pageUrl.protocol !== 'https:' || !['app.1a4.com', 'www.app.1a4.com', '1a4.com', 'www.1a4.com'].includes(pageUrl.hostname.toLowerCase())) {
  console.error('This probe only accepts public 1a4.com Retail ID URLs.');
  process.exit(2);
}

const headers = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
};

function textOnly(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function scriptUrls(html, base) {
  return uniq([...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map(match => {
      try { return new URL(match[1], base).toString(); } catch { return null; }
    }));
}

function candidateStrings(js) {
  const out = new Set();
  const patterns = [
    /https?:\\?\/\\?\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{6,220}/g,
    /["'`](\/[A-Za-z0-9._~:@!$&()*+,;=%-]*(?:api|landing|retail|package|coa|lab|product|cannabinoid|terpene)[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*)["'`]/gi,
    /["'`]([^"'`]{0,80}(?:retailid|landingpage|viewcoa|labresults|cannabinoids|packageDetails)[^"'`]{0,120})["'`]/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(js)) !== null) {
      const value = String(match[1] || match[0] || '').replace(/\\\//g, '/').trim();
      if (value.length >= 4 && value.length <= 260) out.add(value);
      if (out.size >= 250) break;
    }
    if (out.size >= 250) break;
  }
  return [...out];
}

async function fetchText(url, extra = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    headers: { ...headers, ...extra },
  });
  const body = await response.text();
  return { response, body };
}

console.log('=== Retail ID page ===');
console.log(pageUrl.toString());

const page = await fetchText(pageUrl.toString());
console.log('status:', page.response.status);
console.log('final URL:', page.response.url);
console.log('content-type:', page.response.headers.get('content-type'));
console.log('html bytes:', Buffer.byteLength(page.body));
console.log('visible text:', JSON.stringify(textOnly(page.body).slice(0, 800)));

const scripts = scriptUrls(page.body, page.response.url || pageUrl.toString());
console.log(`\n=== Script bundles (${scripts.length}) ===`);
for (const url of scripts) console.log(url);

const allCandidates = new Map();
for (const scriptUrl of scripts.slice(0, 30)) {
  try {
    const item = await fetchText(scriptUrl, { accept: '*/*', referer: page.response.url || pageUrl.toString() });
    if (!item.response.ok || item.body.length > 10_000_000) continue;
    const candidates = candidateStrings(item.body);
    if (candidates.length) allCandidates.set(scriptUrl, candidates);
  } catch (error) {
    console.error('bundle fetch failed:', scriptUrl, '-', error instanceof Error ? error.message : String(error));
  }
}

console.log('\n=== Candidate API/data strings ===');
if (!allCandidates.size) {
  console.log('(none found)');
} else {
  for (const [scriptUrl, candidates] of allCandidates) {
    console.log(`\n# ${scriptUrl}`);
    for (const value of candidates.slice(0, 80)) console.log(value);
  }
}

console.log('\n=== Inline HTML clues ===');
for (const value of candidateStrings(page.body).slice(0, 120)) console.log(value);
