/**
 * The awkward tree.
 *
 * Every row here exists because it is a case the data model claims to
 * handle and a renderer can get wrong. It is small enough to check by
 * eye and deliberately nothing like a tidy pedigree:
 *
 *   Four parents on one child   Rosa has two birth parents and two
 *                               adoptive ones. All four are on record and
 *                               none is an exception to the others.
 *   Two mothers, a donor        Ines and Júlia's son, conceived with a
 *                               known donor — three parentage edges, of
 *                               two different kinds.
 *   A surrogate                 recorded as a parentage edge of its own,
 *                               distinct from the donor.
 *   Twins                       sharing a `multiple_birth`, which no
 *                               amount of shared parentage can express.
 *   Half-siblings               two unions of one man, children of each.
 *   Married, divorced, remarried — one couple, four events. Not two rows.
 *   A step-parent               affinity, not descent: the acyclicity
 *                               rule deliberately lets these loop.
 *   Disputed parentage          kept on the chart and marked.
 *   Disproven parentage         kept on file and off the chart.
 *   An unnamed infant           real, and has no name to show.
 *   Sex not recorded            a diamond with a question mark.
 *   A same-sex marriage         which the schema never had to be taught.
 */
import { log } from "../log.js";
import { uid, upsert, when, exact, inYear, about, type Row } from "./shared.js";

const TREE = uid("tree:vance");
const P = (k: string) => uid(`vance:p:${k}`);

export async function seedComplex(eventType: (code: string) => string, portraits: string[]): Promise<void> {
  const tree = TREE;
  await upsert("trees", tree, {
    name: "The Vance Family", slug: "vance", is_public: false,
    description: "A small family that happens to contain almost every case a genealogy schema has to survive.",
  });

  const lisbon = uid("vance:place:lisbon");
  await upsert("places", lisbon, { tree, name: "Lisbon", type: "city", lat: 38.7223, lng: -9.1393, precision: "settlement" });

  let portraitAt = 0;
  const face = (): Row => (portraits.length ? { portrait: portraits[portraitAt++ % portraits.length]! } : {});

  const person = async (
    k: string, given: string | null, surname: string | null, sex: string,
    born: number | null, died: number | null, extra: Row = {},
  ): Promise<string> => {
    const id = P(k);
    await upsert("persons", id, {
      tree, sex_recorded: sex, is_living: died === null,
      living_basis: died === null ? "reported" : "death_record", ...extra,
    });
    if (given || surname) {
      await upsert("person_names", uid(`vance:n:${k}`), {
        tree, person: id, type: "birth", given, surname, sort_order: 1,
      });
    }
    if (born !== null) {
      await upsert("events", uid(`vance:b:${k}`), {
        tree, type: eventType("birth"), subject_person: id, place: lisbon,
        is_conclusion: true, ...when(born > 1960 ? exact(`${born}-05-14`) : about(born, 2)),
      });
    }
    if (died !== null) {
      await upsert("events", uid(`vance:d:${k}`), {
        tree, type: eventType("death"), subject_person: id, is_conclusion: true, ...when(inYear(died)),
      });
    }
    return id;
  };

  const edge = (k: string, parent: string, child: string, lineage: string, extra: Row = {}) =>
    upsert("parentage", uid(`vance:e:${k}`), { tree, parent, child, lineage, status: "asserted", ...extra });

  const couple = async (k: string, a: string, b: string, sort = 1) => {
    const id = uid(`vance:c:${k}`);
    await upsert("couples", id, { tree, person_a: a, person_b: b, sort });
    return id;
  };

  /* ── the oldest pair, and a man who married twice ──────────────── */
  const abel = await person("abel", "Abel", "Vance", "male", 1928, 2009, face());
  const ruth = await person("ruth", "Ruth", "Vance", "female", 1931, 2014, face());
  const c1 = await couple("abel-ruth", abel, ruth);
  await upsert("events", uid("vance:m1"), {
    tree, type: eventType("marriage"), subject_couple: c1, place: lisbon, is_conclusion: true, ...when(exact("1952-04-19")),
  });
  // One couple, four events — married, divorced, and married each other
  // again. Two `couples` rows would be the wrong shape for this.
  await upsert("events", uid("vance:d1"), {
    tree, type: eventType("divorce"), subject_couple: c1, ...when(inYear(1966)),
  });
  await upsert("events", uid("vance:m2"), {
    tree, type: eventType("marriage"), subject_couple: c1, place: lisbon, ...when(exact("1971-09-02")),
  });

  const mira = await person("mira", "Mira", "Okonjo", "female", 1936, 2018, face());
  const c2 = await couple("abel-mira", abel, mira, 2);
  await upsert("events", uid("vance:m3"), {
    tree, type: eventType("marriage"), subject_couple: c2, ...when(inYear(1968)),
  });

  /* ── half-siblings: one child by each union ─────────────────────── */
  const ines = await person("ines", "Inês", "Vance", "female", 1958, null, face());
  await edge("abel-ines", abel, ines, "birth", { status: "conclusion", confidence: 3 });
  await edge("ruth-ines", ruth, ines, "birth", { status: "conclusion", confidence: 3 });

  const teo = await person("teo", "Téo", "Vance", "male", 1969, null, face());
  await edge("abel-teo", abel, teo, "birth", { status: "conclusion", confidence: 3 });
  await edge("mira-teo", mira, teo, "birth", { status: "conclusion", confidence: 3 });

  // Ruth is Téo's step-mother: affinity, not descent. The acyclicity
  // rule deliberately ignores these, so they may form loops a line of
  // descent never could.
  await edge("ruth-teo-step", ruth, teo, "step");

  /* ── two mothers, a known donor, and a surrogate ────────────────── */
  const julia = await person("julia", "Júlia", "Serrano", "female", 1961, null, face());
  const c3 = await couple("ines-julia", ines, julia);
  await upsert("events", uid("vance:m4"), {
    tree, type: eventType("marriage"), subject_couple: c3, place: lisbon, is_conclusion: true,
    ...when(exact("2011-06-25")), description: "Portugal recognised same-sex marriage in 2010.",
  });

  const donor = await person("donor", "Rafael", "Bittencourt", "male", 1964, null, face());
  const carrier = await person("carrier", "Ana", "Lourenço", "female", 1970, null);

  const bruno = await person("bruno", "Bruno", "Vance Serrano", "male", 2013, null, face());
  await edge("julia-bruno", julia, bruno, "birth", { status: "conclusion", confidence: 3 });
  await edge("ines-bruno", ines, bruno, "adoptive", { confidence: 3 });
  await edge("donor-bruno", donor, bruno, "donor", { confidence: 2 });

  // A second child, where the carrier is not the donor — two distinct
  // edges that a "mother/father" schema could not tell apart.
  const lia = await person("lia", "Lia", "Vance Serrano", "female", 2016, null, face());
  await edge("ines-lia", ines, lia, "birth", { status: "conclusion", confidence: 3 });
  await edge("donor-lia", donor, lia, "donor", { confidence: 2 });
  await edge("carrier-lia", carrier, lia, "surrogate", { confidence: 3 });
  await edge("julia-lia", julia, lia, "adoptive", { confidence: 3 });

  /* ── four parents on one child ──────────────────────────────────── */
  const birthMum = await person("bmum", "Sofia", "Andrade", "female", 1975, null);
  const birthDad = await person("bdad", "Nuno", "Andrade", "male", 1973, 2019);
  const rosa = await person("rosa", "Rosa", "Vance", "female", 1998, null, face());
  await edge("bmum-rosa", birthMum, rosa, "birth", { status: "conclusion", confidence: 3 });
  await edge("bdad-rosa", birthDad, rosa, "birth", { status: "conclusion", confidence: 3 });
  await edge("teo-rosa", teo, rosa, "adoptive", { confidence: 3 });
  const pilar = await person("pilar", "Pilar", "Vance", "female", 1972, null, face());
  await couple("teo-pilar", teo, pilar);
  await edge("pilar-rosa", pilar, rosa, "adoptive", { confidence: 3 });
  await upsert("events", uid("vance:adopt"), {
    tree, type: eventType("adoption"), subject_person: rosa, place: lisbon, ...when(exact("2003-11-07")),
  });

  /* ── twins, an infant with no name, and a sex nobody wrote down ── */
  const twinKey = uid("vance:twins");
  const mateo = await person("mateo", "Mateo", "Vance", "male", 2001, null, { multiple_birth: twinKey, ...face() });
  const nina = await person("nina", "Nina", "Vance", "female", 2001, null, { multiple_birth: twinKey, ...face() });
  for (const [k, t] of [["mateo", mateo], ["nina", nina]] as const) {
    await edge(`teo-${k}`, teo, t, "birth", { status: "conclusion", confidence: 3 });
    await edge(`pilar-${k}`, pilar, t, "birth", { status: "conclusion", confidence: 3 });
  }

  // Recorded in a burial register and nowhere else: no name, no sex, and
  // the death is the only date. Writing "Unknown" into the name would be
  // asserting something the source does not.
  const infant = await person("infant", null, null, "unknown", null, 1955);
  await edge("abel-infant", abel, infant, "birth", { confidence: 2 });
  await edge("ruth-infant", ruth, infant, "birth", { confidence: 2 });
  await upsert("events", uid("vance:sb"), {
    tree, type: eventType("stillbirth"), subject_person: infant, ...when(inYear(1955)),
    description: "Recorded in the parish burial register; no name given.",
  });

  const unsure = await person("unsure", "A.", "Vance", "unknown", 1905, 1961);
  await edge("unsure-abel", unsure, abel, "birth", { confidence: 1 });

  /* ── evidence that disagrees ────────────────────────────────────── */
  // Disputed stays on the chart with a mark; disproven stays on file and
  // off it. Keeping the wrong answer, with the reason, is the point.
  const claimed = await person("claimed", "Emídio", "Vance", "male", 1900, 1958);
  await edge("claimed-abel", claimed, abel, "birth", {
    status: "disputed", confidence: 1,
    notes: "Asserted by a 1974 family history; the 1928 register names no father.",
  });
  const wrong = await person("wrong", "Henrique", "Vance", "male", 1898, 1944);
  await edge("wrong-abel", wrong, abel, "birth", {
    status: "disproven", confidence: 0,
    notes: "Ruled out — he was in Angola from 1925 to 1931. Kept so the question is not asked again.",
  });

  await upsert("trees", tree, { home_person: rosa });
  log.made("vance — four parents, two mothers, a donor, a surrogate, twins, a disputed line and a disproven one");
}
