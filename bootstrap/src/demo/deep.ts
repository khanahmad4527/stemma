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

  const person = async (
    key: string, given: string, surname: string, sex: string, born: number, died: number | null,
  ): Promise<Made> => {
    const id = uid(`ashcombe:${key}`);
    const living = died === null;
    await upsert("persons", id, {
      tree, sex_recorded: sex, is_living: living,
      living_basis: living ? "reported" : "death_record",
      ...(nextPortrait() ? { portrait: nextPortrait() } : {}),
    });
    await upsert("person_names", uid(`ashcombe:n:${key}`), {
      tree, person: id, type: "birth", given, surname, sort_order: 1,
    });
    await upsert("events", uid(`ashcombe:b:${key}`), {
      tree, type: eventType("birth"), subject_person: id, place: somewhere(),
      is_conclusion: true, ...when(born < 1800 ? about(born, 2) : exact(`${born}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`)),
    });
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

  let year = 1648;
  let line = await person("g0m", pick(r, MEN), "Ashcombe", "male", year, year + 62);
  let lineWife = await person("g0f", pick(r, WOMEN), pick(r, WIFE_SURNAMES), "female", year + 3, year + 58);
  await upsert("couples", uid("ashcombe:c:0"), { tree, person_a: line.id, person_b: lineWife.id, sort: 1 });
  await upsert("events", uid("ashcombe:m:0"), {
    tree, type: eventType("marriage"), subject_couple: uid("ashcombe:c:0"),
    place: somewhere(), is_conclusion: true, ...when(about(year + 25, 1)),
  });

  const generations = 10;
  let people = 2, unions = 1, edges = 0;

  for (let g = 1; g < generations; g++) {
    // Roughly a generation every 28 years, with a little drift.
    year += 26 + Math.floor(r() * 6);
    const kids = 2 + Math.floor(r() * 2);
    const heirIndex = Math.floor(r() * kids);
    let heir: Made | null = null;

    for (let k = 0; k < kids; k++) {
      const isHeir = k === heirIndex;
      const male = isHeir || r() < 0.5;
      const last = g >= generations - 1;
      const died = last && r() < 0.6 ? null : year + 55 + Math.floor(r() * 30);
      const child = await person(
        `g${g}k${k}`, pick(r, male ? MEN : WOMEN), "Ashcombe", male ? "male" : "female", year, died,
      );
      people++;
      await edge(`g${g}k${k}a`, line.id, child.id); edges++;
      await edge(`g${g}k${k}b`, lineWife.id, child.id); edges++;
      if (isHeir) heir = child;
    }

    if (!heir || g === generations - 1) break;
    const spouse = await person(
      `g${g}s`, pick(r, WOMEN), pick(r, WIFE_SURNAMES), "female", year + 2, year + 60 + Math.floor(r() * 20),
    );
    people++;
    const couple = uid(`ashcombe:c:${g}`);
    await upsert("couples", couple, { tree, person_a: heir.id, person_b: spouse.id, sort: 1 });
    await upsert("events", uid(`ashcombe:m:${g}`), {
      tree, type: eventType("marriage"), subject_couple: couple,
      place: somewhere(), is_conclusion: true, ...when(about(year + 25, 1)),
    });
    unions++;
    line = heir; lineWife = spouse;
  }

  // The youngest generation is the one a reader opens on.
  await upsert("trees", tree, { home_person: line.id });
  log.made(`ashcombe — ${generations} generations, ${people} people, ${unions} unions, ${edges} edges`);
}
