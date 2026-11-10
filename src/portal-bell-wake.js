// Bell refetch rules (iOS #1594, CPU_NOTIFICATIONS_PUSH_ANDROID_PARITY). list_my_notifications was
// the largest CPU cost in Prod, so the bell asks for it less often:
// - Realtime: the first signal fetches at once (leading). Further signals inside the next 2.5 s are
//   merged into one trailing fetch when the window closes.
// - Focus / visible again: skipped while a fetch is running or the last successful one is < 15 s old;
//   otherwise it goes through the same window as Realtime.
// - Opening the bell and «Prøv igjen» always fetch at once.
// - Idle fallback (Realtime is the live path): only when nothing succeeded for 10 minutes.

export const WAKE_WINDOW_MS = 2500;
export const FOREGROUND_FRESH_MS = 15_000;
export const IDLE_REFRESH_MS = 600_000;

export const createBellWaker = ({
  fetch, // () => Promise<unknown>; success is reported with markSuccess()
  isHidden = () => false,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  windowMs = WAKE_WINDOW_MS,
  freshMs = FOREGROUND_FRESH_MS,
  idleMs = IDLE_REFRESH_MS,
}) => {
  let windowUntil = 0;
  let trailing = false;
  let timer = null;
  let inflight = 0;
  let lastSuccessAt = null;

  const run = () => {
    inflight += 1;
    let pending;
    try { pending = Promise.resolve(fetch()); } catch { pending = Promise.resolve(); }
    pending.catch(() => {}).finally(() => { inflight -= 1; });
  };
  const openWindow = () => {
    windowUntil = now() + windowMs;
    clearTimer(timer);
    timer = setTimer(flush, windowMs);
  };
  function flush() {
    timer = null;
    if (!trailing) return;
    trailing = false;
    if (isHidden()) return;
    run();
    openWindow();
  }

  const signal = () => {
    if (isHidden()) return;
    if (now() < windowUntil) { trailing = true; return; }
    trailing = false;
    run();
    openWindow();
  };
  const fresh = () => lastSuccessAt != null && now() - lastSuccessAt < freshMs;

  return {
    signal,
    foreground() {
      if (isHidden() || inflight > 0 || fresh()) return;
      signal();
    },
    immediate() {
      trailing = false;
      run();
    },
    idleTick() {
      if (isHidden() || inflight > 0) return;
      if (lastSuccessAt != null && now() - lastSuccessAt < idleMs) return;
      signal();
    },
    markSuccess() { lastSuccessAt = now(); },
    stop() { clearTimer(timer); timer = null; trailing = false; },
  };
};
