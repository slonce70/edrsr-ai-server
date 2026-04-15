const DEV_APP_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
];

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
    return [...new Set(configuredOrigins)];
  }

  return [...new Set([...configuredOrigins, ...DEV_APP_ORIGINS])];
}

export function getAllowedWsOrigins(env = process.env) {
  const configuredOrigins = parseCsv(env.WS_ALLOWED_ORIGINS);
  if (isProductionLike(env.NODE_ENV)) {
    return [...new Set(configuredOrigins)];
  }

  return [...new Set([...configuredOrigins, ...DEV_APP_ORIGINS])];
}

export function allowMissingOrigin(env = process.env) {
  return !isProductionLike(env.NODE_ENV);
}
