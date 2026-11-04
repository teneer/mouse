// Called inside one IndexedDB readwrite transaction: compare-and-swap, no timing lock.
export function resolvePageWrite(remote, local, baseVersion, newId, now) {
  if (remote && remote.version !== baseVersion) {
    if (!remote.deleted && JSON.stringify(remote.content) === JSON.stringify(local.content) && remote.name === local.name) {
      return {page: remote, conflict: false, unchanged: true};
    }
    return {page: {...local, id: newId, name: `${local.name} (충돌 복구)`, version: 1,
      order: now, createdAt: now, updatedAt: now, deleted: false}, conflict: true};
  }
  return {page: {...local, version: (remote?.version || 0) + 1, updatedAt: now, deleted: false}, conflict: false};
}
