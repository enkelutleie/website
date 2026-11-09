// Wall-clock dates for the portal. Norway time, not the device time zone.

const partsOf = (date) => new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
}).formatToParts(date);

const num = (parts, type) => Number(parts.find((p) => p.type === type)?.value ?? "0");

export function osloParts(date = new Date()) {
  const parts = partsOf(date);
  let hour = num(parts, "hour");
  if (hour === 24) hour = 0;
  const year = num(parts, "year");
  const month = num(parts, "month");
  const day = num(parts, "day");
  const minute = num(parts, "minute");
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

const offsetMinutes = (instant) => {
  const p = osloParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, num(partsOf(instant), "second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
};

// date is YYYY-MM-DD and time is HH:mm, both in Europe/Oslo.
export function osloWallToUtcIso(date, time = "00:00") {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  const [hour, minute] = String(time || "00:00").slice(0, 5).split(":").map(Number);
  let utc = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0);
  for (let i = 0; i < 3; i++) utc = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0) - offsetMinutes(new Date(utc)) * 60_000;
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const osloTodayISO = (now = new Date()) => osloParts(now).date;
export const osloYear = (now = new Date()) => osloParts(now).year;
