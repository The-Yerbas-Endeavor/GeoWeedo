import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 4_000_000;
const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_HOST_INTERVAL_MS = 1500;
const DEFAULT_MAX_REDIRECTS = 5;

let activeFetches = 0;
const waiters: Array<() => void> = [];
const hostNextAt = new Map<string, number>();
const hostQueues = new Map<string, Promise<void>>();

function envNumber(name: string, fallback: number, min = 0) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireSlot() {
  const limit = Math.max(1, Math.floor(envNumber('WEBSITE_FETCH_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY, 1)));
  if (activeFetches >= limit) await new Promise<void>(resolve => waiters.push(resolve));
  activeFetches += 1;
}

function releaseSlot() {
  activeFetches = Math.max(0, activeFetches - 1);
  waiters.shift()?.();
}

async function waitForHost(hostname: string) {
  const host = hostname.toLowerCase();
  const interval = envNumber('WEBSITE_FETCH_HOST_INTERVAL_MS', DEFAULT_HOST_INTERVAL_MS);
  const previous = hostQueues.get(host) || Promise.resolve();
  const current = previous.then(async () => {
    const wait = Math.max(0, (hostNextAt.get(host) || 0) - Date.now());
    if (wait) await sleep(wait);
    hostNextAt.set(host, Date.now() + interval);
  });
  hostQueues.set(host, current.catch(() => undefined));
  await current;
}

function isPrivateIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isPrivateIpv6(address: string) {
  const value = address.toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
}

function isPrivateAddress(address: string) {
  const version = isIP(address);
  return version === 4 ? isPrivateIpv4(address) : version === 6 ? isPrivateIpv6(address) : true;
}

async function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Official website URL must use HTTP or HTTPS.');
  if (url.username || url.password) throw new Error('Official website URL may not contain credentials.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Official website URL points to a local or internal host.');
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) throw new Error('Official website URL points to a private network address.');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) {
    throw new Error('Official website host resolves to a private or unavailable network address.');
  }
}

async function readTextLimited(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Official website response is too large to safely inspect.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Official website response is too large to safely inspect.');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function fetchOfficialWebsiteHtml(rawUrl: string) {
  const timeoutMs = envNumber('WEBSITE_FETCH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000);
  const maxBytes = Math.floor(envNumber('WEBSITE_FETCH_MAX_BYTES', DEFAULT_MAX_BYTES, 1024));
  const maxRedirects = Math.floor(envNumber('WEBSITE_FETCH_MAX_REDIRECTS', DEFAULT_MAX_REDIRECTS));
  let current = new URL(rawUrl);

  await acquireSlot();
  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      await assertPublicUrl(current);
      await waitForHost(current.hostname);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(current, {
          redirect: 'manual',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            'User-Agent': 'GeoWeedo/1.0 (+https://geoweedo.com; official business profile enrichment)',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Official website redirect ${response.status} did not include a destination.`);
        if (redirectCount >= maxRedirects) throw new Error('Official website exceeded the redirect limit.');
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) throw new Error(`Official website returned ${response.status}.`);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`Official website returned unsupported content type: ${contentType.split(';')[0]}.`);
      }

      return {
        finalUrl: current.toString(),
        html: await readTextLimited(response, maxBytes),
      };
    }
    throw new Error('Official website exceeded the redirect limit.');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Official website request timed out.');
    throw error;
  } finally {
    releaseSlot();
  }
}
