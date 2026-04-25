export const VALID_WORKSPACE_ROLES = ['owner', 'admin', 'member'];
export const DEFAULT_WORKSPACE_ROLE = 'member';

export const DEFAULT_SHARE_LINK_DAYS = 14;
export const MAX_SHARE_LINK_DAYS = 30;

export function isValidWorkspaceRole(role) {
  return VALID_WORKSPACE_ROLES.includes(role);
}

export function normalizeWorkspaceRole(role) {
  if (typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  return isValidWorkspaceRole(normalized) ? normalized : null;
}

export function parseShareLinkDays(rawValue) {
  if (typeof rawValue === 'undefined' || rawValue === null || rawValue === '') {
    return { ok: true, value: DEFAULT_SHARE_LINK_DAYS };
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return { ok: false, error: 'expiresInDays must be a positive integer' };
  }

  if (parsed > MAX_SHARE_LINK_DAYS) {
    return {
      ok: false,
      error: `expiresInDays must be less than or equal to ${MAX_SHARE_LINK_DAYS}`,
    };
  }

  return { ok: true, value: parsed };
}

export function buildShareUrl(baseUrl, token) {
  if (!baseUrl || !token) return null;
  return `${String(baseUrl).replace(/\/$/, '')}/share/${token}`;
}
