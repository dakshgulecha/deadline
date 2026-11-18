// Shared by the browser (app.js) and the API (api/state.js).
//
// Every deadline and note carries an `updatedAt` timestamp. When two copies of
// the data meet, each item keeps whichever version was edited most recently.
// Deletions are remembered as "tombstones" in `deleted` so a stale device
// can't bring a deleted item back.

const DAY = 24 * 60 * 60 * 1000;
export const TOMBSTONE_TTL_DAYS = 120;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validItems(list) {
  return Array.isArray(list) ? list.filter(item => isRecord(item) && typeof item.id === "string" && item.id) : [];
}

export function stamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function normaliseState(value) {
  const deleted = {};
  if (isRecord(value?.deleted)) {
    for (const [id, time] of Object.entries(value.deleted)) if (typeof time === "string") deleted[id] = time;
  }
  return { deadlines: validItems(value?.deadlines), notes: validItems(value?.notes), deleted };
}

function mergeItems(first, second, deleted) {
  const byId = new Map();
  for (const item of [...first, ...second]) {
    const current = byId.get(item.id);
    if (!current || stamp(item.updatedAt) > stamp(current.updatedAt)) byId.set(item.id, item);
  }
  return [...byId.values()].filter(item => !Object.hasOwn(deleted, item.id) || stamp(item.updatedAt) > stamp(deleted[item.id]));
}

// On a tie, the first argument wins.
export function mergeStates(first, second, now = Date.now()) {
  const a = normaliseState(first);
  const b = normaliseState(second);
  const deleted = { ...a.deleted };
  for (const [id, time] of Object.entries(b.deleted)) {
    if (!Object.hasOwn(deleted, id) || stamp(time) > stamp(deleted[id])) deleted[id] = time;
  }
  const cutoff = now - TOMBSTONE_TTL_DAYS * DAY;
  for (const [id, time] of Object.entries(deleted)) if (stamp(time) < cutoff) delete deleted[id];
  return {
    deadlines: mergeItems(a.deadlines, b.deadlines, deleted),
    notes: mergeItems(a.notes, b.notes, deleted),
    deleted,
  };
}

// Order-independent snapshot, for "did anything actually change?" checks.
export function fingerprint(value) {
  const state = normaliseState(value);
  const byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return JSON.stringify([
    [...state.deadlines].sort(byId),
    [...state.notes].sort(byId),
    Object.entries(state.deleted).sort(([x], [y]) => (x < y ? -1 : 1)),
  ]);
}
