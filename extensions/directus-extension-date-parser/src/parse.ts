/**
 * `abt 1850` → four columns, and nothing else.
 *
 * ── What this is for ───────────────────────────────────────────────────
 *
 * A genealogical date is a range with a qualifier, never a date. The
 * source says "about 1850", "before 1900", "between 1852 and 1855",
 * "24 Feb 1750/51", and the only honest storage is the sentence itself
 * plus a range it could occupy. `date_original` is the evidence and is
 * never parsed away; the other four are derived, sortable, and may be
 * corrected by hand afterwards.
 *
 * ── The shapes are the seed's, not invented here ───────────────────────
 *
 * `bootstrap/src/seed.ts` wrote the demo dates by hand before this
 * existed, and its helpers are the specification:
 *
 *   exact(iso)      qualifier `exact`,  earliest = latest = iso
 *   about(y, 5)     qualifier `about`,  (y-5)-01-01 .. (y+5)-12-31
 *   inYear(y)       qualifier `about`,  y-01-01 .. y-12-31
 *   before(iso)     qualifier `before`, earliest NULL, latest = iso
 *   period(a, b)    qualifier `period`, a-01-01 .. b-12-31
 *
 * `inYear` is the one worth noticing: a bare `1889` becomes **about**
 * spanning that year, not `exact`. It has to, and for a good reason — the
 * database CHECK says `exact` requires `earliest = latest`, so `exact` is
 * only ever a whole day. A year-precision record is a range, and `about`
 * is the qualifier this vocabulary has for a range around a point.
 *
 * ── The database is the other half of the specification ────────────────
 *
 * `stemma_*_date_qualifier_shape` refuses anything else, so every branch
 * below is written to satisfy it rather than to be tidy:
 *
 *   exact                     earliest = latest, both present
 *   before                    earliest NULL, latest present
 *   after                     earliest present, latest NULL
 *   phrase                    both NULL
 *   about|between|period|
 *   estimated|calculated|
 *   interpreted               both present
 *
 * That is why `FROM 1850` with no `TO` becomes `after` and not a
 * half-open `period`: a period with one end NULL is a row Postgres will
 * not accept, and silently widening it to a range nobody wrote would be
 * inventing evidence.
 *
 * ── When it cannot read something ──────────────────────────────────────
 *
 * It answers `phrase`, with both bounds NULL. That is not a failure mode
 * bolted on; it is the model's own word for "the original is all there
 * is" — GEDCOM 7 round-trips it as `PHRASE`, it sorts last, and the
 * evidence survives untouched. Guessing would be worse than refusing, so
 * anything ambiguous refuses: `12/03/1889` is March or December
 * depending on which side of an ocean the clerk stood, and this returns
 * `phrase` rather than pick one.
 */

export type Qualifier =
  | "exact" | "about" | "before" | "after" | "between"
  | "period" | "estimated" | "calculated" | "interpreted" | "phrase";

export type Calendar =
  | "gregorian" | "julian" | "hebrew" | "french_republican" | "islamic"
  | "japanese" | "ethiopian" | "coptic" | "quaker" | "other";

export type Parsed = {
  qualifier: Qualifier;
  earliest: string | null;
  latest: string | null;
  calendar: Calendar;
};

/**
 * How wide an imprecise qualifier is, in the absence of anything better.
 *
 * GEDCOM does not define these — "about 1850" has no width in the
 * standard — so they are a documented convention and a search aid, never
 * a claim about the record. The year figures come from the register;
 * month and day precision extend the same idea downward.
 */
const SPREAD = {
  about: { year: 5, month: 1, day: 10 },
  estimated: { year: 10, month: 6, day: 60 },
  calculated: { year: 1, month: 1, day: 10 },
} as const;

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7,
  AUGUST: 8, SEPTEMBER: 9, SEPT: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

/** GEDCOM's calendar escapes, plus the spellings people actually type. */
const CALENDARS: Record<string, Calendar> = {
  GREGORIAN: "gregorian", JULIAN: "julian", HEBREW: "hebrew",
  "FRENCH R": "french_republican", FRENCH: "french_republican",
  ISLAMIC: "islamic", HIJRI: "islamic", JAPANESE: "japanese",
  ETHIOPIAN: "ethiopian", COPTIC: "coptic", QUAKER: "quaker",
  ROMAN: "other", UNKNOWN: "other",
};

/** Precision is what the source recorded, not what we wish it had. */
type Point = { y: number; m?: number; d?: number };

const pad = (n: number, w = 2): string => String(Math.abs(n)).padStart(w, "0");
const iso = (y: number, m: number, d: number): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Julian → proleptic Gregorian, because `date_earliest` and
 * `date_latest` are always proleptic Gregorian and `date_original` keeps
 * whatever the parish clerk wrote.
 *
 * `floor(y/100) - floor(y/400) - 2` is the standard difference in days,
 * and January and February belong to the previous year's figure because
 * the divergence steps at the century leap day. It is right from the
 * Gregorian reform to well past today; for dates before 1500 it keeps
 * extending the same arithmetic backwards, which is what "proleptic"
 * means.
 */
function julianToGregorian(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const yy = m <= 2 ? y - 1 : y;
  const shift = Math.floor(yy / 100) - Math.floor(yy / 400) - 2;
  const t = Date.UTC(y, m - 1, d + shift);
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * The first and last day the point could be, given how precisely it was
 * recorded.
 *
 * The Julian shift is applied at day and month precision and **not** at
 * year precision, which is a judgement rather than an oversight. The
 * offset is 10 to 13 days; a year-precision record is already uncertain
 * by 365. Converting it anyway turns `1750/51` into
 * `1751-01-12 .. 1752-01-11` — arithmetically right, since a Julian year
 * really does straddle two Gregorian ones, and useless: it reads as a
 * fault, sorts into the wrong year, and buys precision the source never
 * had. At month precision the offset is a third of the span and stays
 * inside one year, so there it earns its keep.
 */
function span(p: Point, calendar: Calendar): [string, string] {
  const lo: [number, number, number] = [p.y, p.m ?? 1, p.d ?? 1];
  const hiM = p.m ?? 12;
  const hi: [number, number, number] = [p.y, hiM, p.d ?? lastDay(p.y, hiM)];
  if (calendar === "julian" && p.m !== undefined) {
    const a = julianToGregorian(...lo), b = julianToGregorian(...hi);
    return [iso(a.y, a.m, a.d), iso(b.y, b.m, b.d)];
  }
  return [iso(...lo), iso(...hi)];
}

const precisionOf = (p: Point): "year" | "month" | "day" =>
  p.d !== undefined ? "day" : p.m !== undefined ? "month" : "year";

/** Shift an ISO day by whole days. Used for `before`/`after` boundaries. */
function shiftDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Widen a span by a whole number of years, months or days on both sides. */
function widen(p: Point, calendar: Calendar, by: { year: number; month: number; day: number }): [string, string] {
  const unit = precisionOf(p);
  const lo: Point = { ...p }, hi: Point = { ...p };
  if (unit === "year") { lo.y = p.y - by.year; hi.y = p.y + by.year; }
  const [a, b] = [span(lo, calendar)[0], span(hi, calendar)[1]];
  if (unit === "year") return [a, b];
  if (unit === "month") return [shiftDays(a, -by.month * 31), shiftDays(b, by.month * 31)];
  return [shiftDays(a, -by.day), shiftDays(b, by.day)];
}

const phrase = (calendar: Calendar): Parsed =>
  ({ qualifier: "phrase", earliest: null, latest: null, calendar });

/**
 * One date, with no qualifier of its own: `12 MAR 1889`, `MAR 1889`,
 * `1889`, `1889-03-12`, `1750/51`.
 *
 * Returns null rather than guessing. A bare `12/03/1889` is deliberately
 * not handled — see the header.
 */
function point(text: string): { p: Point; dual: boolean } | null {
  const s = text.trim().replace(/\.$/, "");
  if (!s) return null;

  // Dual dating: 1750/51 or 1750/1751. The second number is the year by
  // modern reckoning, because the English civil year began on 25 March
  // until 1752 and a clerk writing in February wrote both.
  const dual = /^(.*?)(\d{3,4})\/(\d{1,4})$/.exec(s);
  if (dual) {
    const head = dual[1] ?? "", first = Number(dual[2]), tailRaw = dual[3] ?? "";
    // "1750/51" means 1751; "1750/1751" says it in full.
    const tail = tailRaw.length >= 3
      ? Number(tailRaw)
      : Math.floor(first / 10 ** tailRaw.length) * 10 ** tailRaw.length + Number(tailRaw);
    const inner = point(`${head}${tail}`.trim());
    return inner ? { p: inner.p, dual: true } : null;
  }

  // ISO, the one all-numeric form that is not ambiguous.
  const isoM = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  if (isoM) {
    const y = Number(isoM[1]), m = Number(isoM[2]);
    if (m < 1 || m > 12) return null;
    const d = isoM[3] ? Number(isoM[3]) : undefined;
    if (d !== undefined && (d < 1 || d > lastDay(y, m))) return null;
    return { p: d === undefined ? { y, m } : { y, m, d }, dual: false };
  }

  // 12 MAR 1889 · MAR 1889 · 1889 · 12 MARCH 1889
  const parts = s.split(/[\s,]+/).filter(Boolean);
  const words = parts.map((w) => w.toUpperCase());
  const monthAt = words.findIndex((w) => w in MONTHS);

  if (monthAt === -1) {
    if (parts.length === 1 && /^\d{1,4}$/.test(parts[0] as string)) {
      return { p: { y: Number(parts[0]) }, dual: false };
    }
    return null;
  }

  const m = MONTHS[words[monthAt] as string] as number;
  const rest = parts.filter((_, i) => i !== monthAt);
  const nums = rest.filter((w) => /^\d{1,4}$/.test(w)).map(Number);
  if (rest.length !== nums.length) return null;          // stray words: not a date
  if (nums.length === 1) return { p: { y: nums[0] as number, m }, dual: false };
  if (nums.length === 2) {
    // The four-digit one is the year; the other is the day.
    const [a, b] = nums as [number, number];
    const y = String(a).length === 4 ? a : b;
    const d = y === a ? b : a;
    if (d < 1 || d > lastDay(y, m)) return null;
    return { p: { y, m, d }, dual: false };
  }
  return null;
}

/**
 * The whole grammar. Case-insensitive, and tolerant of the English words
 * beside the GEDCOM abbreviations, because both get typed.
 */
export function parseDate(original: string, defaultCalendar: Calendar = "gregorian"): Parsed {
  let s = String(original ?? "").trim().replace(/\s+/g, " ");
  if (!s) return phrase(defaultCalendar);

  // Calendar escape: @#DJULIAN@ 12 MAR 1750
  let calendar: Calendar = defaultCalendar;
  const esc = /@#D([A-Z ]+)@/i.exec(s);
  if (esc) {
    calendar = CALENDARS[(esc[1] ?? "").trim().toUpperCase()] ?? defaultCalendar;
    s = s.replace(esc[0], " ").trim().replace(/\s+/g, " ");
  }

  const upper = s.toUpperCase();

  // Two-ended forms first: they contain the one-ended keywords.
  const between = /^(?:BET|BETWEEN)\s+(.+?)\s+AND\s+(.+)$/i.exec(upper);
  const fromTo = /^FROM\s+(.+?)\s+TO\s+(.+)$/i.exec(upper);
  if (between || fromTo) {
    const m = (between ?? fromTo) as RegExpExecArray;
    const a = point(m[1] as string), b = point(m[2] as string);
    if (!a || !b) return phrase(calendar);
    const cal = a.dual || b.dual ? "julian" : calendar;
    return {
      qualifier: between ? "between" : "period",
      earliest: span(a.p, cal)[0],
      latest: span(b.p, cal)[1],
      calendar: cal,
    };
  }

  // One-ended. `FROM x` with no `TO` is `after`, and `TO y` alone is
  // `before`, because a period needs both ends to satisfy the CHECK.
  const lead = /^(ABT|ABOUT|CIRCA|CA|C|BEF|BEFORE|TO|AFT|AFTER|FROM|EST|ESTIMATED|CAL|CALCULATED|INT|INTERPRETED)\b\.?\s+(.+)$/i
    .exec(upper);

  const body = lead ? (lead[2] as string) : upper;
  const parsedPoint = point(body);
  if (!parsedPoint) return phrase(calendar);
  const { p, dual } = parsedPoint;
  const cal: Calendar = dual ? "julian" : calendar;
  const [lo, hi] = span(p, cal);

  const key = (lead?.[1] ?? "").toUpperCase();
  switch (key) {
    case "ABT": case "ABOUT": case "CIRCA": case "CA": case "C": {
      const [a, b] = widen(p, cal, SPREAD.about);
      return { qualifier: "about", earliest: a, latest: b, calendar: cal };
    }
    case "EST": case "ESTIMATED": {
      const [a, b] = widen(p, cal, SPREAD.estimated);
      return { qualifier: "estimated", earliest: a, latest: b, calendar: cal };
    }
    case "CAL": case "CALCULATED": {
      const [a, b] = widen(p, cal, SPREAD.calculated);
      return { qualifier: "calculated", earliest: a, latest: b, calendar: cal };
    }
    // Interpreted keeps the recorded precision: somebody read the source
    // and concluded this, so widening it would overstate the doubt.
    case "INT": case "INTERPRETED":
      return { qualifier: "interpreted", earliest: lo, latest: hi, calendar: cal };
    case "BEF": case "BEFORE": case "TO":
      return { qualifier: "before", earliest: null, latest: shiftDays(lo, -1), calendar: cal };
    case "AFT": case "AFTER": case "FROM":
      return { qualifier: "after", earliest: shiftDays(hi, 1), latest: null, calendar: cal };
    default:
      // No qualifier word. A whole day is `exact`; anything coarser is a
      // range, and `about` is this vocabulary's word for a range — see
      // `inYear` in the seed.
      return precisionOf(p) === "day"
        ? { qualifier: "exact", earliest: lo, latest: lo, calendar: cal }
        : { qualifier: "about", earliest: lo, latest: hi, calendar: cal };
  }
}
