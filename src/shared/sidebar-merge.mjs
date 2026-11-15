// Three-way, per-field merging keeps independent window edits. Deletions win
// over stale edits, so a late title/navigation update cannot resurrect a tab.
export function mergeSidebar(base = {}, local = {}, remote = {}) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mergeList = (name, key = row => row.id) => {
    const before = new Map((base[name] || []).map(row => [key(row), row]));
    const mine = new Map((local[name] || []).map(row => [key(row), row]));
    const latest = new Map((remote[name] || []).map(row => [key(row), structuredClone(row)]));
    for (const [id, old] of before) {
      const next = mine.get(id);
      if (!next) { latest.delete(id); continue; }
      if (!latest.has(id)) continue;
      const result = latest.get(id);
      for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (equal(old[field], next[field])) continue;
        if (Object.hasOwn(next, field)) result[field] = structuredClone(next[field]);
        else delete result[field];
      }
    }
    for (const [id, next] of mine) if (!before.has(id)) latest.set(id, structuredClone(next));
    return [...latest.values()];
  };
  return { ...structuredClone(remote), spaces: mergeList('spaces'), folders: mergeList('folders'), items: mergeList('items'),
    archive: mergeList('archive', row => JSON.stringify([row.url, row.archivedAt])),
    focusedSpaceId: local.focusedSpaceId, activeBySpace: structuredClone(local.activeBySpace || {}) };
}
