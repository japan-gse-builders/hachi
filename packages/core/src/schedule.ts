const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to an instant. Times skipped by DST move forward. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const tm = TIME_RE.exec(time);
  if (!tm) throw new Error(`Invalid time: ${time}`);
  const guess = Date.UTC(y, m - 1, d, Number(tm[1]), Number(tm[2]));
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(Math.max(first, second));
}

export function localDate(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** CNV-01 / FAM-02: the next daily call strictly after `now`. */
export function nextCallAt(callTime: string, timeZone: string, now: Date): Date {
  if (!TIME_RE.test(callTime)) throw new Error(`Invalid time: ${callTime}`);
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid time zone: ${timeZone}`);
  const today = localDate(now, timeZone);
  const candidate = zonedTimeToUtc(today, callTime, timeZone);
  if (candidate.getTime() > now.getTime()) return candidate;
  return zonedTimeToUtc(addDays(today, 1), callTime, timeZone);
}

/**
 * Cloud Tasks task id for a resident's call on a local date. Cloud Tasks rejects duplicate
 * names, which prevents the dispatcher from placing the same daily call twice.
 */
export function callTaskId(residentId: string, localCallDate: string, attempt = 0): string {
  const safe = residentId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `call-${safe}-${localCallDate}-${attempt}`;
}

/** Residents whose call time falls in (windowStart, windowEnd] — used by the per-minute dispatcher. */
export function isDue(callTime: string, timeZone: string, windowStart: Date, windowEnd: Date): boolean {
  const next = nextCallAt(callTime, timeZone, windowStart);
  return next.getTime() <= windowEnd.getTime();
}
