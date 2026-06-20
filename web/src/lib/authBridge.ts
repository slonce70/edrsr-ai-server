export type UnauthorizedHandler = () => Promise<string | null>;

let handler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(next: UnauthorizedHandler | null) {
  handler = next;
}

export async function requestTokenRefresh(): Promise<string | null> {
  if (!handler) return null;
  try {
    return await handler();
  } catch {
    return null;
  }
}
