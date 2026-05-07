const DEFAULT_WS_MAX_PAYLOAD_BYTES = 16 * 1024;
const LOG_PREVIEW_LENGTH = 120;

export const WS_MAX_FIELD_LENGTHS = Object.freeze({
  id: 128,
  token: 4096,
});

export function getWsMaxPayloadBytes() {
  const configured = Number.parseInt(process.env.WS_MAX_PAYLOAD_BYTES || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WS_MAX_PAYLOAD_BYTES;
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function validateWsClientMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'message_object_required' };
  }

  if (data.type === 'heartbeat') {
    return { ok: true, data: { type: 'heartbeat' } };
  }

  if (data.type === 'auth') {
    if (!isNonEmptyString(data.token, WS_MAX_FIELD_LENGTHS.token) || data.token.length < 10) {
      return { ok: false, reason: 'invalid_auth_token' };
    }
    return { ok: true, data: { type: 'auth', token: data.token } };
  }

  if (data.type === 'subscribe') {
    if (!isNonEmptyString(data.jobId, WS_MAX_FIELD_LENGTHS.id)) {
      return { ok: false, reason: 'invalid_job_id' };
    }
    const workspaceId =
      typeof data.workspaceId === 'string' && data.workspaceId.trim()
        ? data.workspaceId.trim()
        : null;
    if (workspaceId && workspaceId.length > WS_MAX_FIELD_LENGTHS.id) {
      return { ok: false, reason: 'invalid_workspace_id' };
    }
    return { ok: true, data: { type: 'subscribe', jobId: data.jobId, workspaceId } };
  }

  return { ok: false, reason: 'unknown_message_type' };
}

export function sanitizeWsLogValue(value) {
  const raw = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  const normalized = raw.replace(/\s+/g, ' ').slice(0, LOG_PREVIEW_LENGTH);
  return raw.length > LOG_PREVIEW_LENGTH ? `${normalized}...<truncated>` : normalized;
}

export function parseWsClientMessage(message) {
  try {
    const raw = Buffer.isBuffer(message) ? message.toString('utf8') : String(message || '');
    const parsed = JSON.parse(raw);
    return validateWsClientMessage(parsed);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}
