// Overview calendar card (iOS #1644). The calendar page itself still shows passed events.
import { osloParts, osloWallToUtcIso } from "./oslo-time.js";

const nextIsoDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

const startOf = (item) => {
  const raw = item.item_type === "deadline" ? item.due_at || item.starts_at : item.starts_at || item.due_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Active, not declined. Undated stays. Timed events stay through their end instant.
// All-day stays through the Oslo civil day of the end (or the start), and is gone the next day.
export function overviewShowsEvent(item, now = new Date()) {
  if (!item || item.status !== "active" || item.tenant_response === "declined") return false;
  const start = startOf(item);
  if (!start) return true;
  if (item.all_day) {
    const end = item.ends_at ? new Date(item.ends_at) : null;
    const point = end && !Number.isNaN(end.getTime()) && end > start ? end : start;
    const hideAt = new Date(osloWallToUtcIso(nextIsoDate(osloParts(point).date), "00:00"));
    return now < hideAt;
  }
  const end = item.ends_at ? new Date(item.ends_at) : null;
  const until = end && !Number.isNaN(end.getTime()) && end > start ? end : start;
  return now.getTime() <= until.getTime();
}
