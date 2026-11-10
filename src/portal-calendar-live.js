// Live calendar (iOS #1585): a change on property_calendar_items or maintenance_events from
// another device drops that property's calendar reads at once. One quiet redraw follows about a
// second later, so a burst of signals costs a single calendar refetch, and only while the
// calendar (Oversikt, #kalender or #kalender/<id>) for that property is on screen.

// Tables on the notifications-domain channel that also feed the calendar.
export const CALENDAR_TABLES = new Set(["property_calendar_items", "maintenance_events"]);

// Read-cache keys behind calendarCard: the item list, list_calendar_item_responses and its v2.
export const calendarCacheKeys = (pid) => [`cal:${pid}`, `calresp:${pid}`, `calresp2:${pid}`];

// property_id from a postgres_changes payload, or null (e.g. maintenance_events has none).
export const calendarSignalProperty = (payload) => {
  const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old;
  const pid = row?.property_id;
  return pid ? String(pid) : null;
};

// One handler per subscribed table: the bell is always woken as before; calendar tables
// also tell the calendar, with the payload so it knows which property changed.
export const domainChangeHandler = (table, { wakeBell, calendar }) => (payload) => {
  wakeBell();
  if (calendar && CALENDAR_TABLES.has(table)) calendar(payload);
};

export function createCalendarLive({
  invalidate,
  selected,
  onScreen,
  redraw,
  isHidden = () => false,
  delay = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let dirty = new Set();
  let running = false;
  let again = false;
  const schedule = (wait = delay) => {
    clearTimer(timer);
    timer = setTimer(flush, wait);
  };
  async function flush() {
    timer = null;
    if (isHidden() || !dirty.size) return; // resume() picks it up when the tab is visible again
    if (running) { again = true; return; }
    const pids = dirty;
    dirty = new Set();
    const pid = onScreen();
    if (!pid || !pids.has(String(pid))) return;
    running = true;
    try {
      await redraw(String(pid));
    } catch {
      // A failed quiet redraw leaves the page as it was; the next visit reads again.
    } finally {
      running = false;
      if (again) { again = false; schedule(); }
    }
  }
  return {
    signal(payload) {
      const pid = calendarSignalProperty(payload) ?? selected() ?? null;
      if (!pid) return;
      for (const key of calendarCacheKeys(pid)) invalidate(key);
      dirty.add(String(pid));
      schedule();
    },
    resume() {
      if (dirty.size && !timer) schedule(0);
    },
    stop() {
      clearTimer(timer);
      timer = null;
      dirty = new Set();
    },
  };
}
