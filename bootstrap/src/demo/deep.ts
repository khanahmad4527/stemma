/**
 * A long line: ten generations of one family, 1650 to today.
 *
 * The point of this tree is depth. Every other demo is small enough to
 * take in at a glance, which is exactly the case that hides problems —
 * a pedigree that looks fine at three generations is where label
 * collisions, layout drift and slow frames come from at ten.
 *
 * Generated rather than typed. Sixty hand-written people would be sixty
 * chances to make a typo, and a generator can be read for its rules
 * instead: each couple marries in their mid-twenties, has two or three
 * children, and one of them carries the line on.
 */
import { log } from "../log.js";
import { uid, upsert, when, exact, inYear, about, rng, pick } from "./shared.js";

const TREE = uid("tree:ashcombe");

const MEN = ["Thomas", "William", "Edmund", "Henry", "Samuel", "George", "Arthur", "Walter", "Edward", "Francis",
             "Reginald", "Albert", "Charles", "Joseph", "Peter", "Hugh", "Alfred", "Stephen"];
const WOMEN = ["Margaret", "Eleanor", "Alice", "Susannah", "Charlotte", "Harriet", "Jane", "Elizabeth", "Mary",
               "Agnes", "Beatrice", "Clara", "Dorothy", "Edith", "Frances", "Grace", "Hannah", "Isabel"];
const WIFE_SURNAMES = ["Marchmont", "Thorne", "Callow", "Redfern", "Ashby", "Pennington", "Loxley", "Brandwood",
                       "Garrow", "Winslow", "Halliwell", "Fennimore"];
const PLACES = ["Ashcombe", "Wetherby", "Stannington", "Marlbrook", "Netherfield", "Cranleigh"];

type Made = { id: string; name: string; born: number };

export async function seedDeep(eventType: (code: string) => string, portraits: string[]): Promise<void> {
  const r = rng("ashcombe");
  const tree = TREE;

  await upsert("trees", tree, {
    name: "The Ashcombe Line", slug: "ashcombe", is_public: false,
    description: "Ten generations of one Yorkshire family, from a yeoman farmer in 1650 to the present day.",
    default_name_order: "given_first",
  });

  const places = new Map<string, string>();
  for (const p of PLACES) {
    const id = uid(`ashcombe:place:${p}`);
    places.set(p, id);
    await upsert("places", id, { tree, name: p, type: "village" });
  }
  const somewhere = () => places.get(pick(r, PLACES))!;

  let portraitAt = 0;
  const nextPortrait = (): string | null => {
    // Not everyone. A tree where every single person has a picture is
    // not a tree anybody has, and the initials fallback needs exercising.
    if (!portraits.length || r() < 0.45) return null;
    return portraits[portraitAt++ % portraits.length]!;
  };

  /** Birth events, kept so a share of them can be cited afterwards. */
  const births: Array<{ key: string; event: string; person: string; year: number }> = [];

  const person = async (
    key: string, given: string, surname: string, sex: string, born: number, died: number | null,
  ): Promise<Made> => {
    const id = uid(`ashcombe:${key}`);
    const living = died === null;
    await upsert("persons", id, {
      tree, sex_recorded: sex, is_living: living,
      living_basis: living ? "reported" : "death_record",
      ...((): Record<string, string> => { const f = nextPortrait(); return f ? { portrait: f } : {}; })(),
    });
    await upsert("person_names", uid(`ashcombe:n:${key}`), {
      tree, person: id, type: "birth", given, surname, sort_order: 1,
    });
    await upsert("events", uid(`ashcombe:b:${key}`), {
      tree, type: eventType("birth"), subject_person: id, place: somewhere(),
      is_conclusion: true, ...when(born < 1800 ? about(born, 2) : exact(`${born}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`)),
    });
    births.push({ key, event: uid(`ashcombe:b:${key}`), person: id, year: born });
    if (died !== null) {
      await upsert("events", uid(`ashcombe:d:${key}`), {
        tree, type: eventType("death"), subject_person: id, place: somewhere(),
        is_conclusion: true, ...when(inYear(died)),
      });
    }
    return { id, name: `${given} ${surname}`, born };
  };

  const edge = (key: string, parent: string, child: string, lineage = "birth"): Promise<void> =>
    upsert("parentage", uid(`ashcombe:e:${key}`), { tree, parent, child, lineage, status: "conclusion", confidence: 2 });

  /*
   * ── Depth first, then breadth ────────────────────────────────────────
   *
   * The old generator followed one heir per generation and left every
   * sibling a dead end, which made a ten-generation family that was
   * really a chain: a pedigree of single boxes, and a descendant chart
   * with almost nothing in it. Real families do not narrow like that.
   *
   * So the line stays a line while the records would have been thin —
   * the first five generations are the spine, which is how a 17th
   * century family actually survives into the record — and from the
   * nineteenth century on, siblings marry too and the tree fans out.
   * That gives both shapes something to draw: ten generations upward
   * from the youngest, and four generations of cousins downward from the
   * middle.
   */
  const SPINE_UNTIL = 5;   // before this, only the heir carries on
  const generations = 10;

  type Couple = { husband: Made; wife: Made; key: string };

  let year = 1648;
  const g0m = await person("g0m", pick(r, MEN), "Ashcombe", "male", year, year + 62);
  const g0f = await person("g0f", pick(r, WOMEN), pick(r, WIFE_SURNAMES), "female", year + 3, year + 58);
  await upsert("couples", uid("ashcombe:c:0"), { tree, person_a: g0m.id, person_b: g0f.id, sort: 1 });
  await upsert("events", uid("ashcombe:m:0"), {
    tree, type: eventType("marriage"), subject_couple: uid("ashcombe:c:0"),
    place: somewhere(), is_conclusion: true, ...when(about(year + 25, 1)),
  });

  let frontier: Couple[] = [{ husband: g0m, wife: g0f, key: "0" }];
  let people = 2, unions = 1, edges = 0;
  let midLine: Made | null = null;

  for (let g = 1; g < generations; g++) {
    year += 26 + Math.floor(r() * 6);
    const last = g === generations - 1;
    const next: Couple[] = [];

    for (const [ci, couple] of frontier.entries()) {
      const kids = 2 + Math.floor(r() * (g >= SPINE_UNTIL ? 3 : 2));   // 2–4 later, 2–3 early
      const heirIndex = Math.floor(r() * kids);

      for (let k = 0; k < kids; k++) {
        const isHeir = ci === 0 && k === heirIndex;
        const male = isHeir || r() < 0.5;
        // Not everyone who lived to the present is dead, and nobody in
        // the earlier generations is alive.
        const died = last && r() < 0.6 ? null : year + 55 + Math.floor(r() * 30);
        const key = `g${g}c${ci}k${k}`;
        const child = await person(
          key, pick(r, male ? MEN : WOMEN), "Ashcombe", male ? "male" : "female", year, died,
        );
        people++;
        await edge(`${key}a`, couple.husband.id, child.id); edges++;
        await edge(`${key}b`, couple.wife.id, child.id); edges++;
        if (isHeir && g === SPINE_UNTIL) midLine = child;

        // Who marries: the heir always, so the line never dies out;
        // others only once the family is numerous enough to have left
        // records, and never in the youngest generation.
        const marries = !last && (isHeir || (g >= SPINE_UNTIL && r() < 0.62));
        if (!marries) continue;

        const spouse = await person(
          `${key}s`, pick(r, male ? WOMEN : MEN), pick(r, WIFE_SURNAMES), male ? "female" : "male",
          year + 2, year + 60 + Math.floor(r() * 20),
        );
        people++;
        const cKey = `${g}:${ci}:${k}`;
        await upsert("couples", uid(`ashcombe:c:${cKey}`), {
          tree, person_a: child.id, person_b: spouse.id, sort: 1,
        });
        await upsert("events", uid(`ashcombe:m:${cKey}`), {
          tree, type: eventType("marriage"), subject_couple: uid(`ashcombe:c:${cKey}`),
          place: somewhere(), is_conclusion: true, ...when(about(year + 25, 1)),
        });
        unions++;
        next.push(male
          ? { husband: child, wife: spouse, key: cKey }
          : { husband: spouse, wife: child, key: cKey });
      }
    }

    if (!next.length) break;
    frontier = next;
  }

  /*
   * ── Where any of this came from ──────────────────────────────────────
   *
   * A tree of a hundred and eighteen people with no sources behind it
   * teaches the wrong lesson. The Kowalski tree carries the careful
   * version — conflicting assertions, a negative search, a citation
   * about a living person — and this one carries the ordinary version:
   * most facts cited to the obvious register, a good share not cited at
   * all, which is what a real project in progress looks like.
   *
   * Which source depends on when: parish registers before civil
   * registration, censuses after. A census is one remove from the event
   * it records, so it is `secondary`/`indirect` at confidence 2, while
   * the register the curate wrote at the font is `primary`/`direct` at 3.
   */
  const repo = uid("ashcombe:repo");
  await upsert("repositories", repo, {
    tree, name: "North Riding County Record Office", type: "archive",
    address: "Northallerton, North Yorkshire",
  });

  const SOURCES: Array<{ key: string; title: string; from: number; to: number; type: string;
                         information: string; evidence: string; confidence: number }> = [
    { key: "reg1", title: "Ashcombe St Oswald — baptisms 1640–1754", from: 0, to: 1754,
      type: "original", information: "primary", evidence: "direct", confidence: 3 },
    { key: "reg2", title: "Ashcombe St Oswald — baptisms 1754–1837", from: 1755, to: 1837,
      type: "original", information: "primary", evidence: "direct", confidence: 3 },
    { key: "gro", title: "General Register Office, births 1837–1900", from: 1838, to: 1900,
      type: "original", information: "primary", evidence: "direct", confidence: 3 },
    { key: "cens", title: "Census of England and Wales, 1851–1911", from: 1901, to: 9999,
      type: "derivative", information: "secondary", evidence: "indirect", confidence: 2 },
  ];
  for (const src of SOURCES) {
    await upsert("sources", uid(`ashcombe:src:${src.key}`), {
      tree, title: src.title, type: src.type, repository: repo,
    });
  }
  const sourceFor = (year: number) => SOURCES.find((x) => year >= x.from && year <= x.to) ?? SOURCES[SOURCES.length - 1]!;

  let cited = 0;
  for (const birth of births) {
    // Not all of them. An archive where every fact is already sourced is
    // a finished project, and nobody has one of those.
    if (r() > 0.55) continue;
    const src = sourceFor(birth.year);
    const cit = uid(`ashcombe:cit:${birth.key}`);
    await upsert("citations", cit, {
      tree, source: uid(`ashcombe:src:${src.key}`),
      locator: src.key === "cens"
        ? `${1851 + 10 * Math.floor(r() * 7)} census, piece ${100 + Math.floor(r() * 800)}, folio ${Math.floor(r() * 90)}`
        : `p. ${1 + Math.floor(r() * 300)}, entry ${1 + Math.floor(r() * 40)}`,
      information: src.information, evidence: src.evidence, confidence: src.confidence,
    });
    await upsert("citation_links", uid(`ashcombe:cl:e:${birth.key}`), {
      tree, citation: cit, collection: "events", item: birth.event,
    });
    await upsert("citation_links", uid(`ashcombe:cl:p:${birth.key}`), {
      tree, citation: cit, collection: "persons", item: birth.person,
    });
    cited++;
  }
  log.made(`ashcombe — 1 repository, ${SOURCES.length} sources, ${cited} citations`);

  /*
   * Open in the middle, not at either end.
   *
   * The youngest person has ten generations above and nothing below; the
   * oldest has the reverse. A reader landing on the fifth generation gets
   * a pedigree that fills and a descendant chart that fans, which is the
   * whole point of seeding a family this size.
   */
  await upsert("trees", tree, { home_person: (midLine ?? frontier[0]?.husband)?.id ?? null });
  log.made(`ashcombe — ${generations} generations, ${people} people, ${unions} unions, ${edges} edges`);
}
