import { fetchScLabsSample, ingestScLabsSample } from '../lib/scLabs.ts';

const sourceUrl = process.argv[2]?.trim();

if (!sourceUrl) {
  console.error('Usage: npm run weedo:ingest:sc-labs -- <SC Labs sample URL>');
  console.error('Example: npm run weedo:ingest:sc-labs -- "https://client.sclabs.com/sample/123456/"');
  process.exit(1);
}

if (!/^https:\/\/client\.sclabs\.com\/sample\/\d+\/?$/i.test(sourceUrl)) {
  console.error('Expected a current SC Labs sample URL with a numeric sample ID, for example:');
  console.error('https://client.sclabs.com/sample/123456/');
  process.exit(1);
}

console.log(`Fetching SC Labs sample: ${sourceUrl}`);
try {
  const sample = await fetchScLabsSample(sourceUrl);
  console.log(`Sample ${sample.sampleId}: ${sample.brandName ? `${sample.brandName} - ` : ''}${sample.productName}`);
  console.log(`Batch: ${sample.batchNumber || 'not exposed'} | UID: ${sample.uid || 'not exposed'} | analytes: ${sample.analytes.length}`);
  const result = ingestScLabsSample(sample);
  console.log(`Weedo Facts ingestion complete: product=${result.productId} batch=${result.batchId} analytes=${result.analyteCount}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
