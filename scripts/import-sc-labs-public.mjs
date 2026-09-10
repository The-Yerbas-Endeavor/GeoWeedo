import fs from 'fs';
import path from 'path';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from '../lib/scLabs.ts';
import { normalizeScLabsPublicSample } from '../lib/scLabsPublicIdentity.ts';
import { getDatabase } from '../lib/sqlite.ts';
import { ensureWeedoFactsSchema } from '../lib/weedoFacts.ts';

function loadEnvFile(filename = '.env.local') {
  const target = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(target)) return;
  const content = fs.readFileSync(target, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnvFile();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function argValues(name) {
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function argValue(name, fallback) {
  return argValues(name).at(-1) ?? fallback;
}

function existingScLabsPublicUrls() {
  try {
    ensureWeedoFactsSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT DISTINCT source_url
      FROM cannabis_batches
      WHERE source_name = 'SC Labs' AND source_url IS NOT NULL AND source_url <> ''
    `).all();
    return rows.map(row => String(row.source_url || '').trim()).filter(isScLabsSampleUrl);
  } catch {
    return [];
  }
}

const dryRun = process.argv.includes('--dry-run');
const currentYear = new Date().getUTCFullYear();
const year = Number(argValue('--year', String(currentYear)));
const sinceText = String(argValue('--since', `${year}-01-01`));
const since = new Date(`${sinceText}T00:00:00Z`);
const limit = Math.max(1, Math.min(1000, Number(argValue('--limit', '250')) || 250));
const pages = Math.max(1, Math.min(5, Number(argValue('--pages', '2')) || 2));
const seedUrls = [...new Set([...existingScLabsPublicUrls(), ...argValues('--url').filter(isScLabsSampleUrl)])];
const customQueries = argValues('--query');

if (!Number.isFinite(year) || Number.isNaN(since.getTime())) {
  console.error('Invalid --year or --since value. Example: --year 2026 --since 2026-01-01');
  process.exit(1);
}

function normalizeSearxngBase(raw) {
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

async function searchSearxng(query, pageNumber) {
  const raw = String(process.env.SEARXNG_URL || '').trim();
  if (!raw) throw new Error('SEARXNG_URL is not configured. Add it to .env.local or supply one or more --url seeds.');
  const endpoint = normalizeSearxngBase(raw);
  endpoint.pathname = `${endpoint.pathname}/search`.replace(/\/+/g, '/');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('language', 'en');
  endpoint.searchParams.set('safesearch', '1');
  endpoint.searchParams.set('pageno', String(pageNumber));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'GeoWeedo/1.0 SC Labs public catalog discovery' },
    });
    if (!response.ok) throw new Error(`SearXNG returned HTTP ${response.status}.`);
    const body = await response.json();
    return Array.isArray(body?.results) ? body.results : [];
  } finally {
    clearTimeout(timer);
  }
}

function defaultQueries() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const lastMonth = year === now.getUTCFullYear() ? now.getUTCMonth() : 11;
  const queries = [
    `site:client.sclabs.com phytofacts \"Date Issued\" \"${year}\"`,
    `site:client.sclabs.com phytofacts \"Sample ID\" \"${String(year).slice(-2)}\"`,
    `site:client.sclabs.com phytofacts cannabis ${year}`,
  ];
  for (let month = 0; month <= lastMonth; month += 1) {
    queries.push(`site:client.sclabs.com phytofacts \"${months[month]}\" \"${year}\"`);
  }
  return queries;
}

function relaxedQueries() {
  const shortYear = String(year).slice(-2);
  return [
    `\"client.sclabs.com\" \"PhytoFacts\" \"${year}\"`,
    `\"SC Labs\" \"PhytoFacts\" \"${year}\"`,
    `\"client.sclabs.com\" \"Sample ID\" \"${shortYear}\"`,
    `\"SC Labs\" \"Date Issued\" \"${year}\" \"PhytoFacts\"`,
    `client.sclabs.com phytofacts ${year}`,
  ];
}

function extractLocs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map(match => match[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean);
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/xml,text/xml,text/plain,text/html;q=0.8,*/*;q=0.5', 'User-Agent': 'GeoWeedo/1.0 SC Labs public catalog discovery' },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverFromSitemaps(urls) {
  const queue = [
    'https://client.sclabs.com/sitemap.xml',
    'https://client.sclabs.com/sitemap_index.xml',
  ];
  const seen = new Set();
  let sitemapDocuments = 0;
  let additions = 0;

  while (queue.length && seen.size < 40 && urls.size < limit) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);

    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;
    sitemapDocuments += 1;

    for (const location of extractLocs(xml)) {
      if (isScLabsSampleUrl(location)) {
        if (!urls.has(location)) additions += 1;
        urls.add(location);
        if (urls.size >= limit) break;
        continue;
      }

      try {
        const parsed = new URL(location);
        if (/(^|\.)sclabs\.com$/i.test(parsed.hostname) && /\.xml(?:$|\?)/i.test(parsed.pathname + parsed.search) && !seen.has(location)) {
          queue.push(location);
        }
      } catch {}
    }

    if (urls.size < limit) await sleep(250);
  }

  if (sitemapDocuments) {
    console.log(`SC Labs sitemap discovery: ${sitemapDocuments} sitemap document${sitemapDocuments === 1 ? '' : 's'}, +${additions} PhytoFacts URLs`);
  }
  return additions;
}

function sampleDate(sample) {
  const value = sample.testedAt || sample.collectedAt || null;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function summarize(sample) {
  const brand = sample.brandName || 'brand not identified';
  const business = sample.producerName || 'licensed business not exposed';
  const license = sample.producerLicenseNumber ? ` (${sample.producerLicenseNumber})` : '';
  return `${brand} | ${sample.productName} | licensed business: ${business}${license} | sample ${sample.sampleId}`;
}

async function runSearchQueries(urls, queries, label) {
  let totalAdditions = 0;
  console.log(`${label} with ${queries.length} search queries...`);
  for (const query of queries) {
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      try {
        const results = await searchSearxng(query, pageNumber);
        let additions = 0;
        for (const item of results) {
          const link = String(item?.url || '').trim();
          if (!isScLabsSampleUrl(link)) continue;
          if (!urls.has(link)) additions += 1;
          urls.add(link);
          if (urls.size >= limit) break;
        }
        totalAdditions += additions;
        console.log(`  page ${pageNumber}: ${query} -> ${results.length} results, +${additions} SC Labs URLs`);
      } catch (error) {
        console.warn(`  discovery warning: ${error instanceof Error ? error.message : error}`);
      }
      if (urls.size >= limit) break;
      await sleep(650);
    }
    if (urls.size >= limit) break;
  }
  return totalAdditions;
}

async function discoverUrls() {
  const urls = new Set(seedUrls);
  const queries = customQueries.length ? customQueries : defaultQueries();
  if (seedUrls.length) console.log(`Starting with ${seedUrls.length} existing/manual SC Labs public source URL${seedUrls.length === 1 ? '' : 's'}.`);

  await discoverFromSitemaps(urls);
  if (urls.size >= limit) return { urls, queries };

  if (!String(process.env.SEARXNG_URL || '').trim()) return { urls, queries: [] };

  const beforeSearch = urls.size;
  await runSearchQueries(urls, queries, 'Discovering SC Labs public PhytoFacts pages');

  if (!customQueries.length && urls.size === beforeSearch && urls.size < limit) {
    console.log('Strict SearXNG site queries found no new SC Labs pages; retrying with broader public-web queries...');
    await runSearchQueries(urls, relaxedQueries(), 'Retrying SC Labs discovery');
  }

  return { urls, queries };
}

const { urls } = await discoverUrls();
if (!urls.size) {
  console.error('No SC Labs public PhytoFacts URLs were discovered. Check SEARXNG_URL or add --url <public PhytoFacts URL>.');
  process.exit(1);
}

console.log(`\nEvaluating ${Math.min(urls.size, limit)} discovered public SC Labs records since ${sinceText}${dryRun ? ' (dry run)' : ''}...`);
let considered = 0;
let imported = 0;
let skippedOld = 0;
let failed = 0;
const brands = new Set();
const businesses = new Set();

for (const sourceUrl of [...urls].slice(0, limit)) {
  considered += 1;
  try {
    const sample = normalizeScLabsPublicSample(await fetchScLabsSample(sourceUrl));
    const date = sampleDate(sample);
    if (date && date < since) {
      skippedOld += 1;
      console.log(`SKIP old: ${sample.sampleId} | ${sample.testedAt || sample.collectedAt}`);
      continue;
    }

    if (sample.brandName) brands.add(sample.brandName);
    if (sample.producerName) businesses.add(sample.producerName);
    console.log(`${dryRun ? 'WOULD IMPORT' : 'IMPORT'}: ${summarize(sample)}`);
    if (!dryRun) ingestScLabsSample(sample);
    imported += 1;
  } catch (error) {
    failed += 1;
    console.warn(`FAIL: ${sourceUrl} | ${error instanceof Error ? error.message : error}`);
  }
  await sleep(350);
}

console.log('\nSC Labs public catalog import summary');
console.log(`  discovered/considered: ${considered}`);
console.log(`  ${dryRun ? 'eligible' : 'imported/updated'}: ${imported}`);
console.log(`  skipped before ${sinceText}: ${skippedOld}`);
console.log(`  failed: ${failed}`);
console.log(`  consumer brands identified: ${brands.size}`);
console.log(`  licensed businesses identified: ${businesses.size}`);
console.log('  Identity rule: SC Labs Business Name is stored as the licensed business, not automatically as the consumer brand.');
