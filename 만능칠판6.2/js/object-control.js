export const OBJECT_CONTROL_LEASE_MS = 5 * 60 * 1000;
export const OBJECT_CONTROL_RENEW_MS = 60 * 1000;

export function objectControlDocumentId(pageId, objectId) {
  return String(pageId) + '__' + String(objectId);
}

export function objectControlKey(pageId, objectId) {
  return String(pageId) + '::' + String(objectId);
}

export function timestampMillis(value) {
  if (Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
  return 0;
}

export function objectControlLeaseExpired(lock, now = Date.now()) {
  return !lock?.ownerDevice || timestampMillis(lock.leaseUntil) <= now;
}

export function objectControlOwnerMatches(lock, deviceId, tabId, token) {
  return !!lock && lock.ownerDevice === deviceId && lock.ownerTab === tabId &&
    (token === undefined || lock.token === token);
}

export function objectControlRequestMatches(lock, deviceId, tabId, requestId) {
  return !!lock && !!requestId && lock.requestDevice === deviceId &&
    lock.requestTab === tabId && lock.requestId === requestId;
}
