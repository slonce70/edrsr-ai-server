const DEV_APP_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
];

const PROD_APP_ORIGINS = [
  'https://edrsr-ai-server.fun',
  'https://www.edrsr-ai-server.fun',
  'https://app.edrsr-ai-server.fun',
];

const PROD_WS_ORIGINS = [...PROD_APP_ORIGINS, 'https://reyestr.court.gov.ua'];

export function isProductionLike(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === 'production' || nodeEnv === 'staging';
}

export function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getAllowedChromeExtensionIds(env = process.env) {
  return parseCsv(env.CHROME_EXTENSION_IDS || env.CHROME_EXTENSION_ID);
}

export function isAllowedChromeExtensionOrigin(origin, env = process.env) {
  if (typeof origin !== 'string' || !origin.startsWith('chrome-extension://')) {
    return false;
  }

  const allowedIds = getAllowedChromeExtensionIds(env);
  if (allowedIds.length === 0) {
    return !isProductionLike(env.NODE_ENV);
  }

  return allowedIds.some((id) => origin === `chrome-extension://${id}`);
}

export function getAllowedHttpOrigins(env = process.env) {
  const configuredOrigins = parseCsv(env.CORS_ALLOWED_ORIGINS);
  if (isProductionLike(env.NODE_ENV)) {
    return [...new Set(configuredOrigins.length > 0 ? configuredOrigins : PROD_APP_ORIGINS)];
  }

  return [...new Set([...configuredOrigins, ...DEV_APP_ORIGINS])];
}

export function getAllowedWsOrigins(env = process.env) {
  const configuredOrigins = parseCsv(env.WS_ALLOWED_ORIGINS);
  if (isProductionLike(env.NODE_ENV)) {
    return [...new Set(configuredOrigins.length > 0 ? configuredOrigins : PROD_WS_ORIGINS)];
  }

  return [...new Set([...configuredOrigins, ...DEV_APP_ORIGINS])];
}

export function allowMissingOrigin(_env = process.env) {
  return true;
}
