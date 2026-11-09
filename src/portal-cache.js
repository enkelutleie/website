// Session read cache for the portal. Same tables and RPCs as before; a successful
// read is shared until the caller invalidates it after their own change. A failed
// read is forgotten so the next visit can try again.

export function createReadCache() {
  const settled = new Map();
  const pending = new Map();
  const remember = (key, value) => {
    pending.delete(key);
    if (value?.error) return value;
    settled.set(key, value);
    return value;
  };
  return {
    read(key, load) {
      if (settled.has(key)) return Promise.resolve(settled.get(key));
      if (pending.has(key)) return pending.get(key);
      const promise = Promise.resolve().then(load).then(
        (value) => remember(key, value),
        (error) => remember(key, { error }),
      );
      pending.set(key, promise);
      return promise;
    },
    find(prefix) {
      const keys = new Set([...settled.keys(), ...pending.keys()]);
      return [...keys].filter((key) => key.startsWith(prefix)).map((key) => ({
        key,
        promise: pending.get(key) ?? Promise.resolve(settled.get(key)),
      }));
    },
    put(key, value) {
      pending.delete(key);
      settled.set(key, value);
    },
    invalidate(prefix) {
      for (const key of [...settled.keys(), ...pending.keys()]) {
        if (prefix == null || key === prefix || key.startsWith(prefix)) {
          settled.delete(key);
          pending.delete(key);
        }
      }
    },
  };
}

// manual_occupants, one list per tenancy. A full read (the shell) marks every
// tenancy as known, including those with no row, so history does not ask again.
export function createOccupantCache() {
  let complete = false;
  const byTenancy = new Map();
  return {
    rememberAll(rows) {
      byTenancy.clear();
      for (const row of rows ?? []) {
        if (!row?.tenancy_id) continue;
        const list = byTenancy.get(row.tenancy_id) ?? [];
        list.push(row);
        byTenancy.set(row.tenancy_id, list);
      }
      complete = true;
    },
    rememberTenancy(tenancyId, rows) {
      if (tenancyId) byTenancy.set(tenancyId, rows ?? []);
    },
    rows(tenancyId) {
      return byTenancy.get(tenancyId) ?? [];
    },
    // Ids that are not already known. Empty when the full list was loaded.
    missing(tenancyIds) {
      if (complete) return [];
      return [...new Set(tenancyIds)].filter((id) => id && !byTenancy.has(id));
    },
    invalidate(tenancyId) {
      complete = false;
      if (tenancyId) byTenancy.delete(tenancyId);
      else byTenancy.clear();
    },
  };
}

// clear_inspection_review_done is only worth a call when the loaded row says so.
export const shouldClearInspectionReviewDone = (inspection) => inspection?.review_done === true;

export function createConcurrencyGate(limit) {
  let active = 0;
  const waiting = [];
  return (fn) => new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active -= 1;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (active < limit) start();
    else waiting.push(start);
  });
}

// Separate queues per collection, so two albums do not block each other and one
// album never uploads more than `limit` files at once.
export function createKeyedGate(limit) {
  const gates = new Map();
  return (key, fn) => {
    const id = key || "_";
    let gate = gates.get(id);
    if (!gate) {
      gate = createConcurrencyGate(limit);
      gates.set(id, gate);
    }
    return gate(fn);
  };
}

// Runs `fn` for each item with at most `limit` in flight. A thrown or returned
// error does not cancel work that already started; nothing further is started.
export async function mapWithLimit(items, limit, fn) {
  const gate = createConcurrencyGate(limit);
  let stop = false;
  const results = await Promise.all(items.map((item, index) => gate(async () => {
    if (stop) return undefined;
    try {
      const value = await fn(item, index);
      if (value) stop = true;
      return value;
    } catch (error) {
      stop = true;
      return error;
    }
  })));
  return results;
}

// While a save for `key` is in flight, newer payloads replace the queued one.
// Every caller waits. The queued run is the latest payload, so nothing is dropped
// except intermediate states that were never sent. The last state is always sent.
export function createLatestCoalescer(run) {
  const slots = new Map();
  return (key, payload) => {
    let slot = slots.get(key);
    if (!slot) {
      slot = { running: false, next: null, waiters: [] };
      slots.set(key, slot);
    }
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    slot.next = payload;
    slot.waiters.push({ resolve, reject });
    const pump = () => {
      if (slot.running || slot.next == null) return;
      const current = slot.next;
      const waiters = slot.waiters;
      slot.next = null;
      slot.waiters = [];
      slot.running = true;
      Promise.resolve().then(() => run(key, current)).then(
        (result) => { waiters.forEach((waiter) => waiter.resolve(result)); },
        (error) => { waiters.forEach((waiter) => waiter.reject(error)); },
      ).finally(() => {
        slot.running = false;
        if (slot.next != null) pump();
        else slots.delete(key);
      });
    };
    pump();
    return promise;
  };
}
