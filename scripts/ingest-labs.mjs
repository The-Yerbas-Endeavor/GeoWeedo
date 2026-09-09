import { getLabProvider } from '../lib/labProviders/index.ts';
import { runLabIngestion } from '../lib/labIngestion.ts';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const providerId = arg('provider', 'sc-labs');
const maxItems = Number(arg('max', '500'));
const refreshHours = Number(arg('refresh-hours', '24'));
const provider = getLabProvider(providerId);

if (!provider) {
  console.error(`Unknown lab provider: ${providerId}`);
  process.exit(2);
}

try {
  const summary = await runLabIngestion(provider, {
    triggerType: 'scheduled',
    maxItems: Number.isFinite(maxItems) ? maxItems : 500,
    refreshHours: Number.isFinite(refreshHours) ? refreshHours : 24,
  });
  console.log(JSON.stringify(summary, null, 2));
  // Per-source failures are recorded in SQLite and should not make the hourly
  // systemd unit fail. Reserve a non-zero exit for a run-level failure.
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
}
