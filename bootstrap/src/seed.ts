/**
 * A demo tree small enough to hold in your head and awkward enough to be
 * worth testing against.
 *
 * Every row exists to exercise something the schema claims:
 *
 *   Pedigree collapse   Tomasz and Zofia are first cousins who married, so
 *                       Jan and Maria reach Katarzyna down two paths.
 *   A living person     Katarzyna, born 1985. The reason the public filter
 *                       exists; the checks assert she and every row that
 *                       names her are invisible — including her residence,
 *                       which is why ul. Długa 12 is an `address` place, and
 *                       the 2011 census she appears in as a household member.
 *   Adoption            Wojciech is Piotr's son by adoption, with the
 *                       adoption event behind the edge.
 *   Two names           Maria is Wiśniewska at birth and Kowalska by
 *                       marriage, the married name dated by the marriage
 *                       event. Anna is Kowalska at birth and "Kowalski" on
 *                       the New York manifest.
 *   Conflicting births  Jan's baptism says 12 March 1879; the 1901 census
 *                       says "aged 22", which calculates to 1878/79. Both
 *                       kept, both cited, the baptism marked the conclusion.
 *   A negative search   The 1855–69 register was searched and no Kowalski
 *                       was there. Cited as negative evidence on Jan.
 *   A household         The 1921 census is one event with Jan and Maria as
 *                       its subject-couple and the children as participants.
 *   A changed name      Danzig until 1945, Gdańsk after. One place, two names.
 *   A private tree      The Fairbairns are not public. A dead Fairbairn must
 *                       be as invisible to a stranger as a living Kowalski.
 *
 * Dates are entered as the five columns directly. A parser from
 * `date_original` to the other four is the hook extension's job; the seed
 * shows what it should produce.
 */
import { api, login, must } from "./client.js";
import { log } from "./log.js";
import { DEMO_PASSWORD } from "./env.js";
import { uploadPortraits } from "./demo/portraits.js";
import { seedDeep } from "./demo/deep.js";
import { seedComplex } from "./demo/complex.js";

const KOWALSKI = "8f1c0000-0000-4000-8000-00000000f001";
const FAIRBAIRN = "8f1c0000-0000-4000-8000-00000000f002";

/** Stable ids so re-seeding updates rather than duplicating. */
const P = {
  jan: "8f1c0000-0000-4000-8000-00000000a001", maria: "8f1c0000-0000-4000-8000-00000000a002",
  piotr: "8f1c0000-0000-4000-8000-00000000a003", anna: "8f1c0000-0000-4000-8000-00000000a004",
  tomasz: "8f1c0000-0000-4000-8000-00000000a005", zofia: "8f1c0000-0000-4000-8000-00000000a006",
  katarzyna: "8f1c0000-0000-4000-8000-00000000a007", wojciech: "8f1c0000-0000-4000-8000-00000000a008",
  hamish: "8f1c0000-0000-4000-8000-00000000a009", stanislaw: "8f1c0000-0000-4000-8000-00000000a010",
};
const COUPLE = { janMaria: "8f1c0000-0000-4000-8000-00000000d001", tomaszZofia: "8f1c0000-0000-4000-8000-00000000d002" };
const PLACE = {
  poland: "8f1c0000-0000-4000-8000-00000000b101", gdansk: "8f1c0000-0000-4000-8000-00000000b102",
  krakow: "8f1c0000-0000-4000-8000-00000000b103", usa: "8f1c0000-0000-4000-8000-00000000b104",
  newYork: "8f1c0000-0000-4000-8000-00000000b105", dluga: "8f1c0000-0000-4000-8000-00000000b106",
  scotland: "8f1c0000-0000-4000-8000-00000000b107",
};
/** Event ids: e + 3 hex digits. Referenced from names and edges, so fixed. */
const E = (n: string): string => `8f1c0000-0000-4000-8000-00000000e${n}`;
const REPO = { archive: "8f1c0000-0000-4000-8000-00000000f101", familysearch: "8f1c0000-0000-4000-8000-00000000f102" };
const SRC = (n: number): string => `8f1c0000-0000-4000-8000-00000000f2${String(n).padStart(2, "0")}`;
const CIT = (n: number): string => `8f1c0000-0000-4000-8000-00000000f3${String(n).padStart(2, "0")}`;
const T = (i: number): string => `8f1c0000-0000-4000-8000-0000000e${String(i).padStart(4, "0")}`;

type Row = Record<string, unknown>;

/** Create or update by id, so `pnpm seed` twice is the same as once. */
async function upsert(collection: string, id: string, row: Row): Promise<void> {
  const found = await api.get(`/items/${collection}/${id}`);
  const r = found.ok
    ? await api.patch(`/items/${collection}/${id}`, row)
    : await api.post(`/items/${collection}`, { id, ...row });
  if (!r.ok) log.fail(`${collection}/…${id.slice(-4)} — ${r.error.message}`);
}

/** By (tree, user): the owner trigger may have made the row first. */
async function membership(tree: string, user: string, role: string): Promise<void> {
  const found = await api.get<Array<{ id: string }>>(
    `/items/tree_members?limit=1&fields=id&filter[tree][_eq]=${tree}&filter[user][_eq]=${user}`);
  const r = found.ok && found.data[0]
    ? await api.patch(`/items/tree_members/${found.data[0].id}`, { role })
    : await api.post("/items/tree_members", { tree, user, role });
  if (!r.ok) log.fail(`membership ${role} — ${r.error.message}`);
}

/** A five-column date, spelled the way the parser should spell it. */
type D = { original: string; qualifier: string; earliest?: string; latest?: string; calendar?: string };
const when = (d: D): Row => ({
  date_original: d.original, date_qualifier: d.qualifier,
  date_earliest: d.earliest ?? null, date_latest: d.latest ?? null, date_calendar: d.calendar ?? "gregorian",
});
const exact = (iso: string, original: string): D => ({ original, qualifier: "exact", earliest: iso, latest: iso });
const about = (y: number, spread = 5): D => ({ original: `abt ${y}`, qualifier: "about", earliest: `${y - spread}-01-01`, latest: `${y + spread}-12-31` });
const inYear = (y: number): D => ({ original: `${y}`, qualifier: "about", earliest: `${y}-01-01`, latest: `${y}-12-31` });
const before = (iso: string, original: string): D => ({ original, qualifier: "before", latest: iso });
const period = (from: number, to: number): D => ({ original: `from ${from} to ${to}`, qualifier: "period", earliest: `${from}-01-01`, latest: `${to}-12-31` });

async function account(email: string, first: string, last: string, roleId: string): Promise<string | null> {
  const found = await must<Array<{ id: string }>>(`find ${email}`,
    api.get(`/users?limit=1&fields=id&filter[email][_eq]=${encodeURIComponent(email)}`));
  if (found[0]) {
    await api.patch(`/users/${found[0].id}`, { password: DEMO_PASSWORD, role: roleId, status: "active" });
    return found[0].id;
  }
  const r = await api.post<{ id: string }>("/users", {
    email, password: DEMO_PASSWORD, first_name: first, last_name: last, role: roleId, status: "active",
  });
  if (r.ok) return r.data.id;
  if (/seats? limit/i.test(r.error.message)) { log.warn(`${email} not created — the licence allows no more seats`); return null; }
  log.fail(`create ${email}: ${r.error.status} ${r.error.message}`);
  return null;
}

/* ── the vocabulary ────────────────────────────────────────────────────── */

type EventType = { code: string; label: string; applies: "person" | "couple" | "either"; category: string;
  vital?: boolean; endsLife?: boolean; gedcom?: string };

/** GEDCOM 7's events and attributes, plus what genealogists record and it lacks. Global rows. */
export const EVENT_TYPES: EventType[] = [
  { code: "birth", label: "Birth", applies: "person", category: "vital", vital: true, gedcom: "BIRT" },
  { code: "stillbirth", label: "Stillbirth", applies: "person", category: "vital", vital: true, endsLife: true },
  { code: "baptism", label: "Baptism", applies: "person", category: "religious", vital: true, gedcom: "BAPM" },
  { code: "christening", label: "Christening", applies: "person", category: "religious", gedcom: "CHR" },
  { code: "bar_mitzvah", label: "Bar mitzvah", applies: "person", category: "religious", gedcom: "BARM" },
  { code: "bat_mitzvah", label: "Bat mitzvah", applies: "person", category: "religious", gedcom: "BASM" },
  { code: "confirmation", label: "Confirmation", applies: "person", category: "religious", gedcom: "CONF" },
  { code: "first_communion", label: "First communion", applies: "person", category: "religious", gedcom: "FCOM" },
  { code: "ordination", label: "Ordination", applies: "person", category: "religious", gedcom: "ORDN" },
  { code: "religion", label: "Religion", applies: "person", category: "attribute", gedcom: "RELI" },
  { code: "adoption", label: "Adoption", applies: "person", category: "legal", vital: true, gedcom: "ADOP" },
  { code: "death", label: "Death", applies: "person", category: "vital", vital: true, endsLife: true, gedcom: "DEAT" },
  { code: "burial", label: "Burial", applies: "person", category: "vital", vital: true, endsLife: true, gedcom: "BURI" },
  { code: "cremation", label: "Cremation", applies: "person", category: "vital", vital: true, endsLife: true, gedcom: "CREM" },
  { code: "funeral", label: "Funeral", applies: "person", category: "vital", endsLife: true },
  { code: "probate", label: "Probate", applies: "person", category: "legal", gedcom: "PROB" },
  { code: "will", label: "Will", applies: "person", category: "legal", gedcom: "WILL" },
  { code: "engagement", label: "Engagement", applies: "couple", category: "civil", gedcom: "ENGA" },
  { code: "banns", label: "Banns", applies: "couple", category: "religious", gedcom: "MARB" },
  { code: "marriage_contract", label: "Marriage contract", applies: "couple", category: "legal", gedcom: "MARC" },
  { code: "marriage_licence", label: "Marriage licence", applies: "couple", category: "civil", gedcom: "MARL" },
  { code: "marriage", label: "Marriage", applies: "couple", category: "vital", vital: true, gedcom: "MARR" },
  { code: "civil_union", label: "Civil union", applies: "couple", category: "civil", vital: true },
  { code: "separation", label: "Separation", applies: "couple", category: "civil" },
  { code: "divorce", label: "Divorce", applies: "couple", category: "vital", vital: true, gedcom: "DIV" },
  { code: "annulment", label: "Annulment", applies: "couple", category: "legal", gedcom: "ANUL" },
  { code: "census", label: "Census", applies: "either", category: "civil", gedcom: "CENS" },
  { code: "residence", label: "Residence", applies: "either", category: "residence", gedcom: "RESI" },
  { code: "occupation", label: "Occupation", applies: "person", category: "occupation", gedcom: "OCCU" },
  { code: "apprenticeship", label: "Apprenticeship", applies: "person", category: "occupation" },
  { code: "retirement", label: "Retirement", applies: "person", category: "occupation", gedcom: "RETI" },
  { code: "education", label: "Education", applies: "person", category: "education", gedcom: "EDUC" },
  { code: "graduation", label: "Graduation", applies: "person", category: "education", gedcom: "GRAD" },
  { code: "military_service", label: "Military service", applies: "person", category: "military" },
  { code: "military_discharge", label: "Military discharge", applies: "person", category: "military" },
  { code: "emigration", label: "Emigration", applies: "either", category: "migration", gedcom: "EMIG" },
  { code: "immigration", label: "Immigration", applies: "either", category: "migration", gedcom: "IMMI" },
  { code: "naturalisation", label: "Naturalisation", applies: "person", category: "legal", gedcom: "NATU" },
  { code: "property", label: "Property", applies: "either", category: "property", gedcom: "PROP" },
  { code: "land_transaction", label: "Land transaction", applies: "either", category: "property" },
  { code: "court_appearance", label: "Court appearance", applies: "person", category: "legal" },
  { code: "manumission", label: "Manumission", applies: "person", category: "legal" },
  { code: "heimat", label: "Heimat", applies: "person", category: "residence" },
  { code: "nationality", label: "Nationality", applies: "person", category: "attribute", gedcom: "NATI" },
  { code: "title", label: "Title", applies: "person", category: "attribute", gedcom: "TITL" },
  { code: "physical_description", label: "Physical description", applies: "person", category: "attribute", gedcom: "DSCR" },
  { code: "caste", label: "Caste", applies: "person", category: "attribute", gedcom: "CAST" },
  { code: "identification_number", label: "Identification number", applies: "person", category: "attribute", gedcom: "IDNO" },
  { code: "number_of_children", label: "Number of children", applies: "either", category: "attribute", gedcom: "NCHI" },
  { code: "number_of_marriages", label: "Number of marriages", applies: "person", category: "attribute", gedcom: "NMR" },
  { code: "dna_test", label: "DNA test", applies: "person", category: "other" },
  { code: "event", label: "Other event", applies: "either", category: "other", gedcom: "EVEN" },
  { code: "fact", label: "Other fact", applies: "either", category: "attribute", gedcom: "FACT" },
];
const type = (code: string): string => {
  const i = EVENT_TYPES.findIndex((t) => t.code === code);
  if (i < 0) throw new Error(`no event type ${code}`);
  return T(i);
};

/* ── the tree ───────────────────────────────────────────────────────────── */

export async function seed(): Promise<void> {
  log.step("Event vocabulary (global)");
  for (const [i, t] of EVENT_TYPES.entries()) {
    await upsert("event_types", T(i), {
      tree: null, code: t.code, label: t.label, applies_to: t.applies, category: t.category,
      is_vital: t.vital ?? false, ends_life: t.endsLife ?? false, gedcom_tag: t.gedcom ?? null, sort: i,
    });
  }
  log.made(`${EVENT_TYPES.length} event types`);

  log.step("Accounts");
  const roles = await must<Array<{ id: string; name: string }>>("list roles", api.get("/roles?limit=-1&fields=id,name"));
  const member = roles.find((r) => r.name === "Member");
  if (!member) { log.fail('no "Member" role — run `pnpm policies` first'); return; }
  const owner = await account("owner@stemma.example.com", "Katarzyna", "Kowalska", member.id);
  const cousin = await account("cousin@stemma.example.com", "Bartek", "Nowak", member.id);
  const stranger = await account("stranger@stemma.example.com", "Iain", "Fairbairn", member.id);
  log.made([owner && "owner", cousin && "cousin", stranger && "stranger"].filter(Boolean).join(", ") + " @stemma.example.com");

  log.step("Trees");
  await upsert("trees", KOWALSKI, {
    name: "The Kowalski Family", slug: "kowalski", is_public: true, is_listed: true,
    description: "Four generations of a Gdańsk blacksmith's family, from the 1870s to today.",
    default_name_order: "given_first", particle_sorting: "ignore",
    ...(owner ? { owner } : {}),
  });
  await upsert("trees", FAIRBAIRN, {
    name: "The Fairbairns", slug: "fairbairn", is_public: false, particle_sorting: "include",
    ...(stranger ? { owner: stranger } : {}),
  });
  log.made("kowalski (public), fairbairn (private)");

  log.step("Membership");
  // The owner trigger made the owner rows. The cousin may add but not
  // delete; the stranger belongs to the other tree entirely.
  if (cousin) await membership(KOWALSKI, cousin, "contributor");
  log.made("owner (by trigger), contributor" + (stranger ? ", and an outsider owning the other tree" : ""));

  log.step("Places");
  await upsert("places", PLACE.poland, { tree: KOWALSKI, name: "Poland", type: "country", geonames_id: "798544", wikidata_id: "Q36" });
  await upsert("places", PLACE.gdansk, { tree: KOWALSKI, name: "Gdańsk", type: "city", parent_place: PLACE.poland,
    lat: 54.352, lng: 18.6466, precision: "settlement", geonames_id: "3099434", wikidata_id: "Q1792", gov_id: "DANZIGJO94FH" });
  await upsert("places", PLACE.krakow, { tree: KOWALSKI, name: "Kraków", type: "city", parent_place: PLACE.poland,
    lat: 50.0647, lng: 19.945, precision: "settlement", wikidata_id: "Q31487" });
  await upsert("places", PLACE.usa, { tree: KOWALSKI, name: "United States", type: "country", wikidata_id: "Q30" });
  await upsert("places", PLACE.newYork, { tree: KOWALSKI, name: "New York", type: "city", parent_place: PLACE.usa, wikidata_id: "Q60" });
  // A living person's street: type `address`, referenced only by her
  // residence. The public filter must never show it.
  await upsert("places", PLACE.dluga, { tree: KOWALSKI, name: "ul. Długa 12", type: "address", parent_place: PLACE.gdansk, precision: "address" });
  await upsert("places", PLACE.scotland, { tree: FAIRBAIRN, name: "Scotland", type: "country", wikidata_id: "Q22" });
  // One place, two names: an event dated 1879 shows Danzig.
  await upsert("place_names", "8f1c0000-0000-4000-8000-00000000b201", { tree: KOWALSKI, place: PLACE.gdansk, name: "Danzig", lang: "de", valid_to: "1945-03-30" });
  await upsert("place_names", "8f1c0000-0000-4000-8000-00000000b202", { tree: KOWALSKI, place: PLACE.gdansk, name: "Gdańsk", lang: "pl", valid_from: "1945-03-30" });
  log.made("7 places; one with a name that changed in 1945");

  log.step("People");
  const person = (id: string, tree: string, sex: string, living: boolean, extra: Row = {}) =>
    upsert("persons", id, { tree, sex_recorded: sex, is_living: living, ...extra });
  await person(P.jan, KOWALSKI, "male", false, { biography: "A blacksmith in Danzig for forty years." });
  await person(P.maria, KOWALSKI, "female", false);
  await person(P.piotr, KOWALSKI, "male", false);
  await person(P.anna, KOWALSKI, "female", false);
  await person(P.tomasz, KOWALSKI, "male", false);
  await person(P.zofia, KOWALSKI, "female", false);
  await person(P.wojciech, KOWALSKI, "male", false);
  await person(P.stanislaw, KOWALSKI, "male", false);
  // The whole reason for the public filter.
  await person(P.katarzyna, KOWALSKI, "female", true, { living_basis: "reported",
    notes: "Lives at ul. Długa 12 — this sentence must never appear on the public site." });
  await person(P.hamish, FAIRBAIRN, "male", false);
  log.made("9 Kowalskis (one living) and 1 Fairbairn");

  log.step("Couples");
  await upsert("couples", COUPLE.janMaria, { tree: KOWALSKI, person_a: P.jan, person_b: P.maria, sort: 1 });
  await upsert("couples", COUPLE.tomaszZofia, { tree: KOWALSKI, person_a: P.tomasz, person_b: P.zofia, sort: 1 });
  log.made("2 unions");

  log.step("Events");
  const ev = (n: string, code: string, subject: { person?: string; couple?: string }, d: D | null, extra: Row = {}, tree = KOWALSKI) =>
    upsert("events", E(n), {
      tree, type: type(code), subject_person: subject.person ?? null, subject_couple: subject.couple ?? null,
      ...(d ? when(d) : { date_original: null, date_qualifier: null, date_earliest: null, date_latest: null }), ...extra,
    });
  // Jan — two births, one conclusion. The baptism register is primary and
  // exact; the census age is secondary and calculated.
  await ev("100", "birth", { person: P.jan }, exact("1879-03-12", "12 Mar 1879"),
    { place: PLACE.gdansk, place_original: "Danzig, Westpreußen", is_conclusion: true, confidence: 3 });
  await ev("101", "birth", { person: P.jan }, { original: "1878/79 (aged 22 in 1901)", qualifier: "calculated", earliest: "1878-04-01", latest: "1879-03-31" },
    { age_recorded: "aged 22", confidence: 2, description: "Calculated from the age given on the 1901 census." });
  await ev("102", "occupation", { person: P.jan }, period(1900, 1940), { value: "Blacksmith", place: PLACE.gdansk });
  await ev("103", "death", { person: P.jan }, exact("1952-11-03", "3 Nov 1952"), { place: PLACE.gdansk, is_conclusion: true, confidence: 3 });
  await ev("104", "burial", { person: P.jan }, exact("1952-11-07", "7 Nov 1952"), { place: PLACE.gdansk });
  // Maria
  await ev("105", "birth", { person: P.maria }, about(1882, 3), { place: PLACE.krakow, is_conclusion: true, confidence: 1 });
  await ev("106", "death", { person: P.maria }, inYear(1961), { place: PLACE.gdansk });
  // The marriage — a couple event, with a witness from outside the line.
  await ev("107", "marriage", { couple: COUPLE.janMaria }, exact("1903-06-24", "24 Jun 1903"), { place: PLACE.gdansk, is_conclusion: true, confidence: 3 });
  // A household: one event, the couple as subject, the children as participants.
  await ev("108", "census", { couple: COUPLE.janMaria }, exact("1921-09-30", "30 Sep 1921"), { place: PLACE.gdansk, place_original: "Gdańsk, woj. pomorskie" });
  // Piotr, and Wojciech's adoption behind the edge.
  await ev("109", "birth", { person: P.piotr }, exact("1908-02-02", "2 Feb 1908"), { place: PLACE.gdansk, is_conclusion: true });
  await ev("110", "adoption", { person: P.wojciech }, exact("1932-05-14", "14 May 1932"), { place: PLACE.gdansk, confidence: 3 });
  await ev("111", "birth", { person: P.wojciech }, { original: "around Easter 1925", qualifier: "interpreted", earliest: "1925-03-15", latest: "1925-05-15" });
  await ev("112", "death", { person: P.piotr }, inYear(1998), { place: PLACE.gdansk });
  // Anna — emigrated, and carries the manifest's spelling as a second name.
  await ev("113", "birth", { person: P.anna }, exact("1911-04-19", "19 Apr 1911"), { place: PLACE.gdansk, is_conclusion: true });
  await ev("114", "emigration", { person: P.anna }, exact("1958-04-02", "2 Apr 1958"), { place: PLACE.gdansk });
  await ev("115", "immigration", { person: P.anna }, exact("1958-04-18", "18 Apr 1958"), { place: PLACE.newYork, place_original: "Port of New York" });
  await ev("116", "naturalisation", { person: P.anna }, inYear(1965), { place: PLACE.newYork });
  await ev("117", "death", { person: P.anna }, inYear(2001), { place: PLACE.newYork });
  // The cousins.
  await ev("118", "birth", { person: P.tomasz }, inYear(1940), { place: PLACE.gdansk });
  await ev("119", "birth", { person: P.zofia }, inYear(1945), { place: PLACE.gdansk });
  await ev("120", "marriage", { couple: COUPLE.tomaszZofia }, exact("1982-06-12", "12 Jun 1982"), { place: PLACE.gdansk });
  await ev("121", "death", { person: P.tomasz }, inYear(2015), { place: PLACE.gdansk });
  await ev("122", "death", { person: P.zofia }, inYear(2020), { place: PLACE.gdansk });
  // Katarzyna — living. Her birth and her residence must both stay private.
  await ev("123", "birth", { person: P.katarzyna }, exact("1985-07-09", "9 Jul 1985"), { place: PLACE.gdansk });
  await ev("124", "residence", { person: P.katarzyna }, { original: "from 2010", qualifier: "after", earliest: "2010-01-01" }, { place: PLACE.dluga });
  // A census with a living household member: the whole event is private.
  await ev("125", "census", { couple: COUPLE.tomaszZofia }, exact("2011-03-31", "31 Mar 2011"), { place: PLACE.gdansk });
  await ev("126", "death", { person: P.wojciech }, inYear(1990), { place: PLACE.gdansk });
  await ev("127", "birth", { person: P.stanislaw }, about(1880), { place: PLACE.krakow });
  await ev("128", "death", { person: P.stanislaw }, before("1939-08-31", "bef Sep 1939"));
  // Private tree.
  await ev("129", "death", { person: P.hamish }, inYear(1975), { place: PLACE.scotland }, FAIRBAIRN);
  log.made("30 events: two conflicting births, a household, an adoption, a residence that must stay private");

  log.step("Participants");
  const part = (n: string, event: string, person: string, role: string, detail?: string) =>
    upsert("event_participants", `8f1c0000-0000-4000-8000-00000000e2${n}`, { tree: KOWALSKI, event: E(event), person, role, ...(detail ? { detail } : {}) });
  await part("01", "107", P.stanislaw, "witness", "brother of the bride");
  await part("02", "108", P.piotr, "household_member", "aged 13, scholar");
  await part("03", "108", P.anna, "household_member", "aged 10");
  await part("04", "110", P.piotr, "parent", "adopting father");
  await part("05", "125", P.katarzyna, "household_member", "aged 25");
  log.made("5 participants; one of them living, which hides the 2011 census");

  log.step("Names");
  const name = (n: string, tree: string, p: string, type: string, given: string, surname: string, sort = 1, extra: Row = {}) =>
    upsert("person_names", `8f1c0000-0000-4000-8000-00000000c${n}`, { tree, person: p, type, given, surname, sort_order: sort, ...extra });
  await name("001", KOWALSKI, P.jan, "birth", "Jan", "Kowalski");
  // Two names; the married one sorts first and is dated by the marriage.
  await name("002", KOWALSKI, P.maria, "married", "Maria", "Kowalska", 1, { event: E("107") });
  await name("003", KOWALSKI, P.maria, "birth", "Maria", "Wiśniewska", 2);
  await name("004", KOWALSKI, P.piotr, "birth", "Piotr", "Kowalski");
  await name("005", KOWALSKI, P.anna, "birth", "Anna", "Kowalska");
  await name("006", KOWALSKI, P.tomasz, "birth", "Tomasz", "Kowalski");
  await name("007", KOWALSKI, P.zofia, "birth", "Zofia", "Kowalska");
  await name("008", KOWALSKI, P.katarzyna, "birth", "Katarzyna", "Kowalska");
  await name("009", KOWALSKI, P.wojciech, "birth", "Wojciech", "Kowalski");
  await name("010", KOWALSKI, P.stanislaw, "birth", "Stanisław", "Wiśniewski");
  // The anglicised spelling on the manifest — what her descendants search for.
  await name("011", KOWALSKI, P.anna, "immigrant", "Anna", "Kowalski", 2, { event: E("115"), lang: "en" });
  await name("012", FAIRBAIRN, P.hamish, "birth", "Hamish", "Fairbairn");
  log.made("12 names; two people carrying two of them");

  log.step("Parentage");
  const edge = (n: string, parent: string, child: string, lineage = "birth", extra: Row = {}) =>
    upsert("parentage", `8f1c0000-0000-4000-8000-00000000e0${n}`, { tree: KOWALSKI, parent, child, lineage, ...extra });
  await edge("01", P.jan, P.piotr, "birth", { status: "conclusion", confidence: 3, sort: 1 });
  await edge("02", P.maria, P.piotr, "birth", { status: "conclusion", confidence: 3, sort: 1 });
  await edge("03", P.jan, P.anna, "birth", { sort: 2 });
  await edge("04", P.maria, P.anna, "birth", { sort: 2 });
  await edge("05", P.piotr, P.tomasz);
  await edge("06", P.anna, P.zofia);
  // Pedigree collapse: the cousins' child descends from Jan and Maria twice.
  await edge("07", P.tomasz, P.katarzyna);
  await edge("08", P.zofia, P.katarzyna);
  // Adoption, recorded like everything else, with the event behind it.
  await edge("09", P.piotr, P.wojciech, "adoptive", { event: E("110"), confidence: 3 });
  log.made("9 edges, including two paths to one great-grandchild");

  log.step("Associations");
  await upsert("associations", "8f1c0000-0000-4000-8000-00000000e301", {
    tree: KOWALSKI, person_a: P.wojciech, type: "apprenticed_to", person_b: P.jan, ...when(period(1939, 1944)),
    notes: "At his grandfather's forge.",
  });
  log.made("Wojciech apprenticed to Jan");

  log.step("Sources and citations");
  await upsert("repositories", REPO.archive, { tree: KOWALSKI, name: "Archiwum Państwowe w Gdańsku", type: "archive", url: "https://www.gdansk.ap.gov.pl/" });
  await upsert("repositories", REPO.familysearch, { tree: KOWALSKI, name: "FamilySearch", type: "website", url: "https://www.familysearch.org/" });
  await upsert("sources", SRC(1), { tree: KOWALSKI, title: "St Mary's, Danzig — baptisms 1870–1890", type: "original", repository: REPO.archive });
  await upsert("sources", SRC(2), { tree: KOWALSKI, title: "1901 Prussian census, Danzig", type: "original", repository: REPO.archive });
  await upsert("sources", SRC(3), { tree: KOWALSKI, title: "1921 Polish census, Gdańsk", type: "original", repository: REPO.archive });
  await upsert("sources", SRC(4), { tree: KOWALSKI, title: "St Mary's, Danzig — baptisms 1855–1869", type: "original", repository: REPO.archive });
  await upsert("sources", SRC(5), { tree: KOWALSKI, title: "Polish Genealogical Society index", type: "derivative", repository: REPO.familysearch, url: "https://www.familysearch.org/" });
  await upsert("sources", SRC(6), { tree: KOWALSKI, title: "St Mary's, Danzig — marriages 1900–1910", type: "original", repository: REPO.archive });

  const cite = (n: number, source: number, locator: string, information: string, evidence: string, confidence: number, extra: Row = {}) =>
    upsert("citations", CIT(n), { tree: KOWALSKI, source: SRC(source), locator, information, evidence, confidence, ...extra });
  const link = (n: string, citation: number, collection: string, item: string) =>
    upsert("citation_links", `8f1c0000-0000-4000-8000-00000000f4${n}`, { tree: KOWALSKI, citation: CIT(citation), collection, item });

  await cite(1, 1, "p. 42, entry 17", "primary", "direct", 3, { transcription: "Johann Kowalski, born 12 March, baptised 16 March 1879, son of …" });
  await link("01", 1, "events", E("100"));
  await link("02", 1, "persons", P.jan);
  await cite(2, 2, "household 112, line 3", "primary", "direct", 2, { transcription: "Kowalski, Jan, 22, Schmied" });
  await link("03", 2, "events", E("101"));
  await cite(3, 3, "district 4, household 88", "primary", "direct", 3);
  await link("04", 3, "events", E("108"));
  // Negative evidence: searched, not found. The research log's most valuable entry.
  await cite(4, 4, "whole register, 1855–1869", "undetermined", "negative", 2,
    { notes: "No Kowalski baptism 1855–69 — Jan's parents were not baptising here." });
  await link("05", 4, "persons", P.jan);
  await cite(5, 5, "index entry 33021", "secondary", "indirect", 1);
  await link("06", 5, "events", E("105"));
  await cite(6, 6, "p. 44, entry 3", "primary", "direct", 3);
  await link("07", 6, "events", E("107"));
  await link("08", 6, "couples", COUPLE.janMaria);
  // A citation that supports only a living person: public sees nothing of it.
  await cite(7, 3, "2011 return, line 9", "primary", "direct", 3);
  await link("09", 7, "persons", P.katarzyna);
  log.made("2 repositories, 6 sources, 7 citations, 9 links — one negative, one about the living");

  log.step("Portraits");
  const portraits = await uploadPortraits(KOWALSKI);
  // A few of the Kowalskis get a face; the rest exercise the initials
  // fallback, which is what most real trees look like.
  const faces: Array<[string, number]> = [[P.jan, 0], [P.maria, 1], [P.piotr, 2], [P.anna, 3], [P.tomasz, 4], [P.katarzyna, 5]];
  for (const [id, i] of faces) {
    if (portraits[i]) await upsert("persons", id, { portrait: portraits[i] });
  }
  log.made(`${faces.filter(([, i]) => portraits[i]).length} Kowalskis given a portrait`);

  log.step("Home person");
  // Katarzyna, not Jan.
  //
  // A pedigree opens on the person whose ancestors you want to see, and
  // Jan is the root of the tree — his pedigree is one box. Katarzyna is
  // the deepest descendant, so opening on her shows three generations
  // and the pedigree collapse in the middle of them.
  //
  // She is also living, so an anonymous visitor cannot see her at all.
  // That is deliberate: it exercises the renderer's fallback, which
  // picks the deepest *visible* person when the home person is not in
  // the data it was given.
  await upsert("trees", KOWALSKI, { home_person: P.katarzyna });
  log.made("members open on Katarzyna; the public falls back to whoever they can see");

  // Two more trees: one deep, one awkward. Together with the Kowalskis
  // they cover the three shapes worth testing against — small and
  // interesting, long, and full of exceptions.
  log.step("The Ashcombe Line (ten generations)");
  await seedDeep(type, portraits);

  log.step("The Vance Family (every edge case)");
  await seedComplex(type, portraits);

  // Everybody sees every demo tree, so all three are one click apart.
  log.step("Membership on the new trees");
  const roleRows = await must<Array<{ id: string; name: string }>>("roles", api.get("/roles?limit=-1&fields=id,name"));
  void roleRows;
  for (const slug of ["ashcombe", "vance"]) {
    const found = await must<Array<{ id: string }>>(
      `find ${slug}`, api.get(`/items/trees?limit=1&fields=id&filter[slug][_eq]=${slug}`));
    const t = found[0]?.id;
    if (!t) continue;
    for (const u of [owner, cousin]) if (u) await membership(t, u, "owner");
  }
  log.made("owner and cousin can open all three");
}

async function main(): Promise<void> {
  log.step(`Connecting to ${api.url}`);
  await login();
  await seed();
  const failed = log.failures();
  if (failed > 0) {
    log.warn(`${failed} row${failed === 1 ? "" : "s"} failed`);
    process.exitCode = 1;
    return;
  }
  log.done(`Seeded. Demo accounts share the password ${DEMO_PASSWORD}`);
}

main().catch((err) => {
  log.fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
