import { discoverKannapediaUrls, ingestKannapediaCultivar, parseKannapediaPage, rebuildProductCultivarLinks } from '../lib/kannapedia.ts';

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const dryRun = process.argv.includes('--dry-run');
const limit = Math.max(1, Math.min(2500, Number(argValue('--limit', '1500')) || 1500));
const delayMs = Math.max(50, Math.min(5000, Number(argValue('--delay-ms', '175')) || 175));

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'GeoWeedo/1.0 Kannapedia public cultivar catalog importer',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

console.log('Fetching Kannapedia public cultivar index...');
const indexHtml = await fetchText('https://kannapedia.net/strains');
const urls = discoverKannapediaUrls(indexHtml).slice(0, limit);
console.log(`Discovered ${urls.length} public Kannapedia cultivar URLs${dryRun ? ' (dry run)' : ''}.`);

let processed = 0;
let created = 0;
let updated = 0;
let failed = 0;
let chemistryRecords = 0;
const registrants = new Set();

for (const sourceUrl of urls) {
  try {
    const html = await fetchText(sourceUrl);
    const cultivar = parseKannapediaPage(html, sourceUrl);
    if (cultivar.registrant) registrants.add(cultivar.registrant);
    chemistryRecords += cultivar.chemistry.length;
    if (dryRun) {
      console.log(`WOULD IMPORT: RSP ${cultivar.rspId} | ${cultivar.name} | ${cultivar.registrant || 'registrant not reported'} | chemistry ${cultivar.chemistry.length}`);
    } else {
      const result = ingestKannapediaCultivar(cultivar);
      if (result.created) created += 1;
      else updated += 1;
      console.log(`${result.created ? 'IMPORT' : 'UPDATE'}: RSP ${cultivar.rspId} | ${cultivar.name} | ${cultivar.registrant || 'registrant not reported'} | chemistry ${result.chemistryCount}`);
    }
    processed += 1;
  } catch (error) {
    failed += 1;
    console.warn(`FAIL: ${sourceUrl} | ${error instanceof Error ? error.message : error}`);
  }
  await sleep(delayMs);
}

let links = 0;
if (!dryRun) links = rebuildProductCultivarLinks();

console.log('\nKannapedia public catalog import summary');
console.log(`  discovered: ${urls.length}`);
console.log(`  processed: ${processed}`);
if (!dryRun) {
  console.log(`  created: ${created}`);
  console.log(`  updated: ${updated}`);
  console.log(`  high-confidence product links rebuilt: ${links}`);
}
console.log(`  failed: ${failed}`);
console.log(`  unique registrants: ${registrants.size}`);
console.log(`  registrant-reported chemistry rows observed: ${chemistryRecords}`);
console.log('  Evidence rule: Kannapedia chemistry is stored as registrant-reported, never as verified laboratory batch chemistry.');

if (failed) process.exitCode = 2;
