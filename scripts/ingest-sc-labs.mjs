import { fetchScLabsSample, ingestScLabsSample } from '../lib/scLabs.ts';

const sourceUrl = process.argv[2] || 'https://client.sclabs.com/sample/293930/';

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
