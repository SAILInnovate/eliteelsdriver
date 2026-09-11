/**
 * Offline buffer for GPS breadcrumbs.
 *
 * A phone in a tunnel, a car park, or a rural notspot cannot write to Postgres.
 * Points captured while offline are held here and replayed when the connection
 * comes back, so the trail has gaps in *delivery* but never gaps in *history*.
 *
 * Backed by localStorage so the queue survives the app being killed and
 * relaunched. Deliberately not a native plugin: it must not add a pod/gradle
 * dependency, and the volumes involved (minutes-to-hours of a dead zone) are
 * well inside what localStorage handles.
 *
 * Rows are stored already shaped for `driver_locations` — enqueue what you
 * would have inserted.
 */

const KEY = 'els_driver_location_queue_v1';

// ~2000 points is several hours of driving at a 10m filter. Past that the
// oldest points are dropped: a stale trail head matters less than the recent
// positions ops are actually looking at.
const MAX_POINTS = 2000;

let memory = null; // in-memory mirror, authoritative once loaded

function load() {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    memory = Array.isArray(parsed) ? parsed : [];
  } catch {
    // Private mode, corrupt JSON, or storage disabled — degrade to memory-only.
    memory = [];
  }
  return memory;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Quota exceeded or storage unavailable. The in-memory queue still drains
    // for this session; nothing here should throw into the GPS callback.
  }
}

/** Append a point. Returns the new queue depth. */
export function enqueue(point) {
  const q = load();
  q.push(point);
  if (q.length > MAX_POINTS) q.splice(0, q.length - MAX_POINTS);
  persist();
  return q.length;
}

/** Oldest `n` points, without removing them. */
export function peek(n) {
  return load().slice(0, n);
}

/** Remove the oldest `n` points (call only after they are safely inserted). */
export function drop(n) {
  const q = load();
  q.splice(0, n);
  persist();
  return q.length;
}

/**
 * Discard points that do not belong to `driverId`.
 *
 * RLS on driver_locations is `WITH CHECK (driver_id = auth.uid())`, so points
 * buffered by a previous driver on a shared device would be rejected forever
 * and block every point behind them. Dropping them is the only way out.
 */
export function dropForeign(driverId) {
  const q = load();
  const kept = q.filter((p) => p.driver_id === driverId);
  const removed = q.length - kept.length;
  if (removed > 0) {
    memory = kept;
    persist();
  }
  return removed;
}

export function size() {
  return load().length;
}

export function clear() {
  memory = [];
  persist();
}
