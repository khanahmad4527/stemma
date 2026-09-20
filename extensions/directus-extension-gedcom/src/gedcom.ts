/**
 * GEDCOM 7 out of a graph that deliberately has no `FAM` records.
 *
 * ── The one hard problem ───────────────────────────────────────────────
 *
 * GEDCOM makes a family the node and hangs people off it. This schema
 * does the opposite, on purpose: people are nodes, `couples` and
 * `parentage` are edges, and no `FAM` row exists to export. That is the
 * decision the whole data model rests on — it is what lets a child have
 * two biological and two adoptive parents on record without inventing a
 * family that never existed.
 *
 * So the families are **derived here**, the same way the descendant chart
 * derives them at render time. A drawing needs a family and so does
 * GEDCOM; neither is allowed to make the storage grow one.
 *
 * The derivation, in order:
 *
 *   1. Every `couples` row becomes a family, whether or not it has
 *      children. A childless union is still a union, and losing it on
 *      export would lose a marriage.
 *   2. Every child's parent edges are grouped **by lineage**, because a
 *      child adopted by one couple and born to another belongs to two
 *      families and GEDCOM says so with two `FAMC` links and a `PEDI` on
 *      each.
 *   3. A lineage group of two parents finds or creates the family for
 *      that pair; one parent gets a single-parent family, which GEDCOM
 *      permits.
 *   4. **Three or more parents in one lineage** — which this model allows
 *      and GEDCOM's one-HUSB-one-WIFE `FAM` does not — are split: the
 *      first two make a pair, each remaining parent gets a single-parent
 *      family, and the child links to all of them. Nothing is dropped;
 *      the shape is just flatter than the original.
 *
 * ── What is deliberately not exported ──────────────────────────────────
 *
 * **Media.** An `OBJE` pointing at a file needs a path the receiving
 * program can resolve, and there is no honest answer for that in a
 * download. Better to omit it than to write a link that resolves to
 * nothing on the other machine.
 *
 * **Nothing else.** Anything without a standard tag becomes `EVEN` with a
 * `TYPE`, which is what `EVEN` is for. No extension tags, so no `SCHMA`
 * block, so any conformant reader takes the file.
 *
 * ── Privacy is not this file's job ─────────────────────────────────────
 *
 * The rows arrive already filtered by whoever asked for them — the
 * endpoint reads through Directus with the caller's own permissions, so
 * an anonymous request gets the public policy's answer and a member gets
 * their tree. This serialises what it is handed and makes no decisions
 * about who may see what.
 */

export type Row = Record<string, unknown>;

export type Data = {
  tree: Row;
  persons: Row[];
  names: Row[];
  parentage: Row[];
  couples: Row[];
  events: Row[];
  places: Row[];
  sources: Row[];
  repositories: Row[];
  citations: Row[];
  citationLinks: Row[];
  generatedAt: Date;
};

/* ── tags ──────────────────────────────────────────────────────────────── */

/**
 * Stemma's event codes to GEDCOM 7 tags.
 *
 * Anything absent is not an oversight: GEDCOM has no tag for it, so it
 * goes out as `EVEN` with the label in `TYPE`. Inventing `_MILI` would
 * make the file non-conformant for the sake of a word.
 */
const PERSON_TAGS: Record<string, string> = {
  adoption: "ADOP", baptism: "BAPM", bar_mitzvah: "BARM", bat_mitzvah: "BASM",
  birth: "BIRT", burial: "BURI", caste: "CAST", census: "CENS",
  christening: "CHR", confirmation: "CONF", cremation: "CREM", death: "DEAT",
  education: "EDUC", emigration: "EMIG", first_communion: "FCOM",
  graduation: "GRAD", identification_number: "IDNO", immigration: "IMMI",
  nationality: "NATI", naturalisation: "NATU", number_of_children: "NCHI",
  number_of_marriages: "NMR", occupation: "OCCU", ordination: "ORDN",
  physical_description: "DSCR", probate: "PROB", property: "PROP",
  religion: "RELI", residence: "RESI", retirement: "RETI", title: "TITL",
  will: "WILL", fact: "FACT",
};

const COUPLE_TAGS: Record<string, string> = {
  annulment: "ANUL", banns: "MARB", divorce: "DIV", engagement: "ENGA",
  marriage: "MARR", marriage_contract: "MARC", marriage_licence: "MARL",
  census: "CENS",
};

/** GEDCOM 7's name types. Ours that have no counterpart become OTHER. */
const NAME_TYPES: Record<string, string> = {
  birth: "BIRTH", married: "MARRIED", aka: "AKA",
  immigrant: "IMMIGRANT", professional: "PROFESSIONAL",
};

const SEX: Record<string, string> = { male: "M", female: "F", intersex: "X", unknown: "U" };

/** Stemma lineage to GEDCOM 7 `PEDI`. `birth` is the default and omitted. */
const PEDI: Record<string, string> = {
  adoptive: "ADOPTED", foster: "FOSTER", sealing: "SEALING",
  step: "OTHER", guardian: "OTHER", donor: "OTHER", surrogate: "OTHER", other: "OTHER",
};

/* ── writing lines ─────────────────────────────────────────────────────── */

class Writer {
  private readonly out: string[] = [];

  /**
   * One GEDCOM line.
   *
   * A payload beginning with `@` has to be doubled, or a reader takes it
   * for a cross-reference pointer. That is the only escaping GEDCOM 7
   * asks for — it dropped `CONC`, so long lines simply stay long.
   */
  line(level: number, tag: string, payload?: string | null): void {
    if (payload === undefined || payload === null || payload === "") {
      this.out.push(`${level} ${tag}`);
      return;
    }
    const safe = payload.startsWith("@") && !/^@[^@]+@$/.test(payload) ? `@${payload}` : payload;
    this.out.push(`${level} ${tag} ${safe}`);
  }

  /** A pointer line: `1 HUSB @I3@`. */
  ptr(level: number, tag: string, xref: string): void {
    this.out.push(`${level} ${tag} ${xref}`);
  }

  /** Free text, where a newline becomes a `CONT` rather than a broken file. */
  text(level: number, tag: string, value: unknown): void {
    const s = String(value ?? "").replace(/\r\n?/g, "\n");
    if (!s.trim()) return;
    const [first, ...rest] = s.split("\n");
    this.line(level, tag, first ?? "");
    for (const more of rest) this.line(level + 1, "CONT", more);
  }

  /** CRLF: the terminator every reader accepts, including the old ones. */
  toString(): string {
    return this.out.join("\r\n") + "\r\n";
  }
}

/* ── dates ─────────────────────────────────────────────────────────────── */

const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** `1889-03-12` → `12 MAR 1889`. GEDCOM wants day, month name, year. */
function gedDate(isoDay: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDay ?? ""));
  if (!m) return null;
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  return `${Number(d)} ${MONTH[Number(mo) - 1]} ${Number(y)}`;
}

/** Whole years and whole months collapse, so `1889-01-01..1889-12-31` is `1889`. */
function gedSpan(earliest: unknown, latest: unknown): string | null {
  const a = String(earliest ?? ""), b = String(latest ?? "");
  const ya = a.slice(0, 4), yb = b.slice(0, 4);
  if (a && b && ya === yb) {
    if (a.endsWith("-01-01") && b.endsWith("-12-31")) return ya;
    if (a.slice(5, 7) === b.slice(5, 7) && a.endsWith("-01")) {
      const mo = MONTH[Number(a.slice(5, 7)) - 1];
      const last = new Date(Date.UTC(Number(ya), Number(a.slice(5, 7)), 0)).getUTCDate();
      if (Number(b.slice(8, 10)) === last) return `${mo} ${ya}`;
    }
  }
  return gedDate(earliest) ?? (a ? ya : null);
}

/**
 * The five columns back into GEDCOM's date grammar, with the verbatim
 * original preserved as a `PHRASE` beneath it.
 *
 * The round trip is the point: `date_original` is the evidence, so it
 * travels even when the parsed range is what a reader will sort on. A
 * `phrase` date emits an empty `DATE` with only the `PHRASE`, which is
 * exactly what GEDCOM 7 added `PHRASE` for.
 */
function writeDate(w: Writer, level: number, row: Row): void {
  const q = String(row["date_qualifier"] ?? "");
  const original = String(row["date_original"] ?? "").trim();
  const lo = gedSpan(row["date_earliest"], row["date_latest"]);
  const hi = gedSpan(row["date_latest"], row["date_latest"]);
  const cal = String(row["date_calendar"] ?? "gregorian");
  const prefix = cal === "julian" ? "@#DJULIAN@ " : "";

  let value: string | null = null;
  switch (q) {
    case "exact": value = lo && `${prefix}${lo}`; break;
    case "about": value = lo && `ABT ${prefix}${gedSpan(row["date_earliest"], row["date_latest"]) ?? lo}`; break;
    case "estimated": value = lo && `EST ${prefix}${lo}`; break;
    case "calculated": value = lo && `CAL ${prefix}${lo}`; break;
    case "interpreted": value = lo && `INT ${prefix}${lo}`; break;
    case "before": value = hi && `BEF ${prefix}${hi}`; break;
    case "after": value = lo && `AFT ${prefix}${lo}`; break;
    case "between": value = lo && hi && `BET ${prefix}${lo} AND ${prefix}${hi}`; break;
    case "period": value = lo && hi && `FROM ${prefix}${lo} TO ${prefix}${hi}`; break;
    default: value = lo ? `${prefix}${lo}` : null;
  }

  if (!value && !original) return;
  w.line(level, "DATE", value ?? "");
  // Only when it adds something the value does not already say.
  if (original && original.toUpperCase() !== String(value ?? "").toUpperCase()) {
    w.text(level + 1, "PHRASE", original);
  }
}

/* ── families, derived ─────────────────────────────────────────────────── */

type Family = { xref: string; spouses: string[]; children: { person: string; lineage: string }[] };

const pairKey = (ids: string[]): string => [...ids].sort().join("|");

function deriveFamilies(data: Data): { families: Family[]; byKey: Map<string, Family> } {
  const families: Family[] = [];
  const byKey = new Map<string, Family>();

  const ensure = (spouses: string[]): Family => {
    const key = pairKey(spouses);
    const found = byKey.get(key);
    if (found) return found;
    const fam: Family = { xref: `@F${families.length + 1}@`, spouses: [...spouses].sort(), children: [] };
    families.push(fam);
    byKey.set(key, fam);
    return fam;
  };

  // 1. Unions first, so a childless marriage still gets a record.
  for (const c of data.couples) {
    const a = c["person_a"], b = c["person_b"];
    if (a && b) ensure([String(a), String(b)]);
  }

  // 2. Children, grouped by child and then by lineage.
  const byChild = new Map<string, Map<string, string[]>>();
  for (const edge of data.parentage) {
    const child = String(edge["child"] ?? ""), parent = String(edge["parent"] ?? "");
    if (!child || !parent) continue;
    // A disproven line is kept in the database as a record of the
    // mistake; exporting it would assert it.
    if (edge["status"] === "disproven") continue;
    const lineage = String(edge["lineage"] ?? "birth");
    const forChild = byChild.get(child) ?? new Map<string, string[]>();
    forChild.set(lineage, [...(forChild.get(lineage) ?? []), parent]);
    byChild.set(child, forChild);
  }

  for (const [child, lineages] of byChild) {
    for (const [lineage, parents] of lineages) {
      const sorted = [...new Set(parents)].sort();
      // Two at a time; a third parent in one lineage gets its own
      // single-parent family rather than being dropped.
      const groups: string[][] = sorted.length <= 2 ? [sorted] : [sorted.slice(0, 2), ...sorted.slice(2).map((p) => [p])];
      for (const group of groups) ensure(group).children.push({ person: child, lineage });
    }
  }

  return { families, byKey };
}

/* ── the document ──────────────────────────────────────────────────────── */

export function toGedcom(data: Data): string {
  const w = new Writer();

  const personXref = new Map<string, string>();
  data.persons.forEach((p, i) => personXref.set(String(p["id"]), `@I${i + 1}@`));
  const sourceXref = new Map<string, string>();
  data.sources.forEach((s, i) => sourceXref.set(String(s["id"]), `@S${i + 1}@`));
  const repoXref = new Map<string, string>();
  data.repositories.forEach((r, i) => repoXref.set(String(r["id"]), `@R${i + 1}@`));

  const placeName = new Map<string, string>();
  for (const p of data.places) placeName.set(String(p["id"]), String(p["name"] ?? ""));

  const typeById = new Map<string, Row>();
  for (const e of data.events) {
    const t = e["type"];
    if (t && typeof t === "object") typeById.set(String((t as Row)["id"]), t as Row);
  }

  const { families } = deriveFamilies(data);

  /* HEAD */
  w.line(0, "HEAD");
  w.line(1, "GEDC");
  w.line(2, "VERS", "7.0");
  w.line(1, "SOUR", "STEMMA");
  w.line(2, "NAME", "Stemma");
  w.line(2, "CORP", "Stemma");
  w.line(1, "DATE", gedDate(data.generatedAt.toISOString().slice(0, 10)) ?? "");
  w.line(2, "TIME", data.generatedAt.toISOString().slice(11, 19));
  w.text(1, "NOTE", `Tree: ${String(data.tree["name"] ?? "")}`);

  /* INDI */
  const eventsFor = (personId: string): Row[] =>
    data.events.filter((e) => String(e["subject_person"] ?? "") === personId);

  const citationsFor = (collection: string, item: string): Row[] => {
    const ids = data.citationLinks
      .filter((l) => String(l["collection"]) === collection && String(l["item"]) === item)
      .map((l) => String(l["citation"]));
    return data.citations.filter((c) => ids.includes(String(c["id"])));
  };

  const writeCitations = (level: number, collection: string, item: string): void => {
    for (const c of citationsFor(collection, item)) {
      const src = sourceXref.get(String(c["source"]));
      if (!src) continue;
      w.ptr(level, "SOUR", src);
      if (c["locator"]) w.text(level + 1, "PAGE", c["locator"]);
      const quay = c["confidence"];
      if (quay !== null && quay !== undefined && quay !== "") w.line(level + 1, "QUAY", String(quay));
      if (c["transcription"]) { w.line(level + 1, "DATA"); w.text(level + 2, "TEXT", c["transcription"]); }
    }
  };

  const writeEvent = (level: number, e: Row, tags: Record<string, string>): void => {
    const type = (e["type"] && typeof e["type"] === "object" ? e["type"] as Row : typeById.get(String(e["type"]))) ?? {};
    const code = String(type["code"] ?? "event");
    const tag = tags[code];
    w.line(level, tag ?? "EVEN", tag ? undefined : String(e["value"] ?? ""));
    if (!tag) w.text(level + 1, "TYPE", String(type["label"] ?? code));
    writeDate(w, level + 1, e);
    const place = e["place"];
    const placeId = place && typeof place === "object" ? String((place as Row)["id"]) : String(place ?? "");
    const pname = place && typeof place === "object" ? String((place as Row)["name"] ?? "") : placeName.get(placeId);
    if (pname) w.text(level + 1, "PLAC", pname);
    if (e["notes"]) w.text(level + 1, "NOTE", e["notes"]);
    writeCitations(level + 1, "events", String(e["id"]));
  };

  for (const person of data.persons) {
    const id = String(person["id"]);
    const xref = personXref.get(id);
    if (!xref) continue;
    w.line(0, xref, "INDI");

    const mine = data.names
      .filter((n) => String(n["person"] ?? "") === id)
      .sort((a, b) => Number(a["sort_order"] ?? 0) - Number(b["sort_order"] ?? 0));
    const written = mine.length > 0 ? mine : [{ given: person["display_name"], surname: "" }];
    for (const n of written) {
      const given = String(n["given"] ?? "").trim();
      const surname = String(n["surname"] ?? "").trim();
      w.line(1, "NAME", `${given} /${surname}/`.trim());
      const kind = String(n["type"] ?? "");
      if (kind && kind !== "birth") {
        const mapped = NAME_TYPES[kind];
        w.line(2, "TYPE", mapped ?? "OTHER");
        if (!mapped) w.text(3, "PHRASE", kind.replace(/_/g, " "));
      }
      if (n["prefix"]) w.text(2, "NPFX", n["prefix"]);
      if (given) w.text(2, "GIVN", given);
      if (surname) w.text(2, "SURN", surname);
      if (n["suffix"]) w.text(2, "NSFX", n["suffix"]);
      if (n["nickname"]) w.text(2, "NICK", n["nickname"]);
    }

    w.line(1, "SEX", SEX[String(person["sex_recorded"] ?? "unknown")] ?? "U");
    for (const e of eventsFor(id)) writeEvent(1, e, PERSON_TAGS);

    for (const fam of families) {
      if (fam.spouses.includes(id)) w.ptr(1, "FAMS", fam.xref);
      const asChild = fam.children.find((c) => c.person === id);
      if (asChild) {
        w.ptr(1, "FAMC", fam.xref);
        const pedi = PEDI[asChild.lineage];
        if (pedi) {
          w.line(2, "PEDI", pedi);
          if (pedi === "OTHER") w.text(3, "PHRASE", asChild.lineage.replace(/_/g, " "));
        }
      }
    }

    if (person["biography"]) w.text(1, "NOTE", person["biography"]);
    if (person["notes"]) w.text(1, "NOTE", person["notes"]);
    writeCitations(1, "persons", id);
  }

  /* FAM */
  const sexOf = (id: string): string =>
    SEX[String(data.persons.find((p) => String(p["id"]) === id)?.["sex_recorded"] ?? "unknown")] ?? "U";

  for (const fam of families) {
    w.line(0, fam.xref, "FAM");
    // GEDCOM has one HUSB and one WIFE. Where sex is not recorded the
    // assignment is arbitrary but stable — sorted ids — so two exports of
    // the same tree agree.
    const males = fam.spouses.filter((s) => sexOf(s) === "M");
    const females = fam.spouses.filter((s) => sexOf(s) === "F");
    const rest = fam.spouses.filter((s) => !males.includes(s) && !females.includes(s));
    const husb = males[0] ?? rest[0];
    const wife = females[0] ?? rest.find((r) => r !== husb);
    if (husb && personXref.has(husb)) w.ptr(1, "HUSB", personXref.get(husb) as string);
    if (wife && personXref.has(wife)) w.ptr(1, "WIFE", personXref.get(wife) as string);
    for (const c of fam.children) {
      const x = personXref.get(c.person);
      if (x) w.ptr(1, "CHIL", x);
    }
    const couple = data.couples.find((c) => pairKey([String(c["person_a"]), String(c["person_b"])]) === pairKey(fam.spouses));
    if (couple) {
      for (const e of data.events.filter((e) => String(e["subject_couple"] ?? "") === String(couple["id"]))) {
        writeEvent(1, e, COUPLE_TAGS);
      }
      if (couple["notes"]) w.text(1, "NOTE", couple["notes"]);
    }
  }

  /* SOUR and REPO */
  for (const s of data.sources) {
    const xref = sourceXref.get(String(s["id"]));
    if (!xref) continue;
    w.line(0, xref, "SOUR");
    if (s["title"]) w.text(1, "TITL", s["title"]);
    if (s["author"]) w.text(1, "AUTH", s["author"]);
    if (s["publication"]) w.text(1, "PUBL", s["publication"]);
    const repo = repoXref.get(String(s["repository"] ?? ""));
    if (repo) w.ptr(1, "REPO", repo);
    if (s["notes"]) w.text(1, "NOTE", s["notes"]);
  }

  for (const r of data.repositories) {
    const xref = repoXref.get(String(r["id"]));
    if (!xref) continue;
    w.line(0, xref, "REPO");
    if (r["name"]) w.text(1, "NAME", r["name"]);
    if (r["address"]) { w.line(1, "ADDR"); w.text(2, "ADR1", r["address"]); }
    if (r["url"]) w.text(1, "WWW", r["url"]);
  }

  w.line(0, "TRLR");
  return w.toString();
}
