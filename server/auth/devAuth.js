import crypto from 'crypto';

const IS_PROD_LIKE = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
const DEV_AUTH_ENABLED =
  !IS_PROD_LIKE &&
  ['1', 'true', 'yes'].includes(String(process.env.DEV_AUTH_ENABLED || '').toLowerCase());

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeBase64Url(input) {
  const normalized = String(input || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function createDeterministicUuid(email) {
  const hex = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
  const chars = hex.slice(0, 32).split('');
  chars[12] = '4';
  const variant = parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function isDevAuthEnabled() {
  return DEV_AUTH_ENABLED;
}

export function parseDevAuthToken(token) {
  if (!DEV_AUTH_ENABLED || typeof token !== 'string' || !token.startsWith('dev:')) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(token.slice('dev:'.length)));
    const email = String(payload?.email || '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@')) {
      return null;
    }

    const candidateId = String(payload?.id || '').trim();
    const id = UUID_RE.test(candidateId) ? candidateId : createDeterministicUuid(email);

    return {
      id,
      email,
      mode: 'dev',
    };
  } catch {
    return null;
  }
}
