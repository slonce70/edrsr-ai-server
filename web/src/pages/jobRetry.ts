export function buildRetryBody(clientId: string | null): { clientId: string } {
  if (!clientId) {
    throw new Error('Realtime connection not ready — retry is unavailable.');
  }
  return { clientId };
}
