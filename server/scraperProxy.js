import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Optional outbound HTTP proxy for requests to reyestr.court.gov.ua (the scraper and the health check).
// Off unless SCRAPER_PROXY_URL is set, e.g. http://user:pass@203.0.113.10:3128. Use it when the registry
// blocks the server's own address: the proxy should have an address the registry accepts (Ukrainian).
let cached = { url: null, agent: undefined };

/** @returns {{http: object, https: object} | undefined} got `agent` option, or undefined when no proxy is set */
export function getScraperAgent(env = process.env) {
  const url = String(env.SCRAPER_PROXY_URL || '').trim();
  if (!url) return undefined;
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('SCRAPER_PROXY_URL must start with http:// or https://');
  }
  if (cached.url !== url) {
    cached = { url, agent: { http: new HttpProxyAgent(url), https: new HttpsProxyAgent(url) } };
  }
  return cached.agent;
}
