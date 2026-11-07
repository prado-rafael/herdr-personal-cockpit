// PARKED -- not part of the mod, and not installed (the installers copy only
// mods/personal-cockpit and layouts/). Routines are triggered by hand for now.
//
// This is a working, tested cron implementation: five fields as crontab(5) has
// them, a bounded backwards scan for "did it fire since I last looked?", and a
// day-walking forward search for "when next?". Move it back into the mod folder
// and give a routine a `cadence:` field to use it.
// Cron expressions, and the two questions a routine asks of one.
//
// Five fields, as crontab(5) has them: minute hour day-of-month month
// day-of-week. `*`, `N`, `a-b`, `a,b,c`, `*/n` and `a-b/n`; three-letter names
// for months and weekdays; `0` and `7` both Sunday.
//
// Standard syntax rather than an invented one, and it costs less code than the
// readable DSL it replaced -- because of how the two questions are shaped:
//
//   "did it fire since I last looked?"   a bounded scan backwards, one minute
//                                        at a time, over the catch-up window
//   "when does it fire next?"            day by day over the date fields, then
//                                        the hour and minute sets of that day
//
// Neither needs the open-ended previous-occurrence arithmetic that makes cron
// libraries big. The first is bounded by the window that has to be bounded
// anyway (§ catch_up_hours); the second only walks days.
//
// All times are local wall clock: `0 6 * * *` is six in the morning where the
// machine is. Two laptops in one timezone agree on the firing instant, which is
// what the dedupe key is derived from; two in different timezones would not.

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PART = /^(\*|\d+|[a-z]{3})(?:-(\d+|[a-z]{3}))?(?:\/(\d+))?$/i;

function value(token, names) {
  if (/^\d+$/.test(token)) return Number(token);
  const named = names?.[token.toLowerCase()];
  return named === undefined ? null : named;
}

/** `{ set, star }` -- the values this field admits, and whether it was `*`.
 *  `star` is kept because the day-of-month / day-of-week rule needs to know
 *  which of the two was left unrestricted. Null when the field is malformed. */
function parseField(spec, min, max, names) {
  const star = spec === "*";
  const set = new Set();
  for (const part of spec.split(",")) {
    const m = part.match(PART);
    if (!m) return null;
    const step = m[3] === undefined ? 1 : Number(m[3]);
    if (!Number.isInteger(step) || step < 1) return null;
    let lo, hi;
    if (m[1] === "*") {
      lo = min;
      hi = max;
    } else {
      lo = value(m[1], names);
      if (lo === null) return null;
      if (m[2] !== undefined) {
        hi = value(m[2], names);
        if (hi === null) return null;
      } else {
        // `5/2` means "from 5 to the end, every 2"; a bare `5` means just 5.
        hi = m[3] === undefined ? lo : max;
      }
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set.size ? { set, star } : null;
}

/**
 * `{ minute, hour, dom, month, dow, raw }`, or `{ error }`.
 *
 * The minute field must name its minutes: a bare star, or a star with a step,
 * is refused. A routine that fires every few minutes would open that many tasks
 * an hour, and the dedupe key would faithfully keep every one of them. Nothing
 * here breaks -- the queue does.
 */
export function parse(expression) {
  const raw = String(expression ?? "").trim();
  if (!raw) return { error: "no cron expression" };

  const fields = raw.split(/\s+/);
  if (fields.length !== 5) {
    return { error: `expected 5 fields ("min hour day month weekday"), found ${fields.length}` };
  }

  const [min, hr, dm, mo, dw] = fields;
  if (min === "*" || /^\*\//.test(min)) {
    return { error: "the minute field must name its minutes; every firing opens a task" };
  }

  const minute = parseField(min, 0, 59);
  if (!minute) return { error: `bad minute: "${min}"` };
  const hour = parseField(hr, 0, 23);
  if (!hour) return { error: `bad hour: "${hr}"` };
  const dom = parseField(dm, 1, 31);
  if (!dom) return { error: `bad day of month: "${dm}"` };
  const month = parseField(mo, 1, 12, MONTH);
  if (!month) return { error: `bad month: "${mo}"` };
  const dow = parseField(dw, 0, 7, DOW);
  if (!dow) return { error: `bad weekday: "${dw}"` };

  // Both spellings of Sunday collapse, so matching can read getDay() directly.
  if (dow.set.has(7)) dow.set.add(0);

  return { minute, hour, dom, month, dow, raw };
}

/** The month and day half of a match. Split out because the forward search
 *  walks whole days and only then looks at the clock. */
function dayMatches(c, d) {
  if (!c.month.set.has(d.getMonth() + 1)) return false;
  const dom = c.dom.set.has(d.getDate());
  const dow = c.dow.set.has(d.getDay());
  // crontab(5): when both day fields are restricted, a day matches if *either*
  // does -- `0 6 1 * mon` is the 1st and every Monday, not Mondays that are the
  // 1st. When one is `*`, the other decides alone.
  if (c.dom.star && c.dow.star) return true;
  if (c.dom.star) return dow;
  if (c.dow.star) return dom;
  return dom || dow;
}

export function matches(c, d) {
  return c.minute.set.has(d.getMinutes()) && c.hour.set.has(d.getHours()) && dayMatches(c, d);
}

/**
 * The most recent firing at or before `now`, no further back than
 * `withinMinutes`; null when it did not fire inside that window.
 *
 * The bound is the point, not a shortcut. A routine whose firing is older than
 * the catch-up window is water under the bridge: opening its task now would
 * deliver yesterday's six-o'clock work at noon, and a laptop shut for a week
 * would open seven of them at once.
 */
export function lastFiring(c, now, withinMinutes) {
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  for (let n = 0; n <= withinMinutes; n++) {
    if (matches(c, d)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() - 1);
  }
  return null;
}

/** The next firing after `now`, or null if there is none in the next four
 *  years (`0 0 29 2 *` is the case that needs them). */
export function nextFiring(c, now) {
  const from = new Date(now.getTime());
  from.setSeconds(0, 0);
  from.setMinutes(from.getMinutes() + 1);
  const hours = [...c.hour.set].sort((a, b) => a - b);
  const minutes = [...c.minute.set].sort((a, b) => a - b);
  for (let day = 0; day < 1500; day++) {
    const base = new Date(from.getFullYear(), from.getMonth(), from.getDate() + day);
    if (!dayMatches(c, base)) continue;
    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
        if (t >= from) return t;
      }
    }
  }
  return null;
}

const pad = (n) => String(n).padStart(2, "0");

/** `06:00`, and `06:00/18:00` for a field with several values -- the panel has
 *  one line, so a long list stays the raw expression's problem. */
function clock(c) {
  const hours = [...c.hour.set].sort((a, b) => a - b);
  const minutes = [...c.minute.set].sort((a, b) => a - b);
  if (hours.length * minutes.length > 2) return null;
  const out = [];
  for (const h of hours) for (const m of minutes) out.push(`${pad(h)}:${pad(m)}`);
  return out.join("/");
}

const only = (f, min, max) => (f.star ? null : f.set.size === max - min + 1 ? null : [...f.set].sort((a, b) => a - b));

/**
 * A phrase when the expression has a shape worth one, and the expression itself
 * otherwise. Showing `0 6 * * 1-5` is honest; inventing prose for every cron
 * shape is a second parser nobody asked for.
 */
export function describe(c) {
  if (!c || c.error) return c?.error ?? "";
  const at = clock(c);
  if (!at) return c.raw;

  const months = only(c.month, 1, 12);
  const days = c.dom.star ? null : [...c.dom.set].sort((a, b) => a - b);
  const weekdays = c.dow.star ? null : [...new Set([...c.dow.set].filter((v) => v !== 7))].sort((a, b) => a - b);

  if (months) return c.raw;
  if (days && weekdays) return c.raw;

  if (!days && !weekdays) return `daily ${at}`;

  if (weekdays) {
    if (weekdays.length === 5 && weekdays.every((d, n) => d === n + 1)) return `Mon–Fri ${at}`;
    if (weekdays.length === 2 && weekdays[0] === 0 && weekdays[1] === 6) return `weekends ${at}`;
    if (weekdays.length <= 3) return `${weekdays.map((d) => DOW_SHORT[d]).join("/")} ${at}`;
    return c.raw;
  }

  if (days.length === 1) return `day ${days[0]} ${at}`;
  if (days.length <= 3) return `days ${days.join("/")} ${at}`;
  return c.raw;
}

/** `2026-11-07T06:00` in local time -- the firing's identity, and the half of
 *  the dedupe key that says which occurrence a task belongs to. */
export function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `07/11 06:00`, for the next-firing note in a row. */
export function shortWhen(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

