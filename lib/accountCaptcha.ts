import crypto from 'crypto';

const MIN_AGE_MS = 2000;
const MAX_AGE_MS = 10 * 60 * 1000;

function secret() {
  const value = process.env.GEOWEEDO_SESSION_SECRET?.trim();
  if (!value) throw new Error('Account spam protection is not configured.');
  return value;
}

function deriveNumbers(nonce: string) {
  const digest = crypto.createHmac('sha256', secret()).update(`account-captcha:${nonce}`).digest();
  const a = 2 + (digest[0] % 8);
  const b = 2 + (digest[1] % 8);
  return { a, b };
}

function sign(nonce: string, issuedAt: number) {
  return crypto.createHmac('sha256', secret()).update(`${nonce}.${issuedAt}`).digest('base64url');
}

export function createAccountCaptcha() {
  const nonce = crypto.randomBytes(18).toString('base64url');
  const issuedAt = Date.now();
  const signature = sign(nonce, issuedAt);
  const { a, b } = deriveNumbers(nonce);
  return {
    challenge: `${nonce}.${issuedAt}.${signature}`,
    question: `What is ${a} + ${b}?`,
  };
}

export function verifyAccountCaptcha(challenge: string, answer: string, honeypot?: string) {
  if (honeypot?.trim()) return { ok: false as const, error: 'Anti-spam verification failed.' };

  const [nonce, issuedAtRaw, signature] = challenge.split('.');
  const issuedAt = Number(issuedAtRaw);
  if (!nonce || !issuedAtRaw || !signature || !Number.isFinite(issuedAt)) {
    return { ok: false as const, error: 'Please complete the anti-spam check.' };
  }

  const age = Date.now() - issuedAt;
  if (age < MIN_AGE_MS) return { ok: false as const, error: 'Please take a moment to complete the anti-spam check.' };
  if (age > MAX_AGE_MS || age < 0) return { ok: false as const, error: 'The anti-spam check expired. Please try again.' };

  const expectedSignature = sign(nonce, issuedAt);
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return { ok: false as const, error: 'Anti-spam verification failed.' };
  }

  const { a, b } = deriveNumbers(nonce);
  if (Number(answer) !== a + b) {
    return { ok: false as const, error: 'Incorrect anti-spam answer. Please try again.' };
  }

  return { ok: true as const };
}
