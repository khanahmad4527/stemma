/**
 * The check suite.
 *
 * Two halves, and the discipline that makes either worth running:
 *
 *   **Both directions.** Every access check has a twin asserting the
 *   refusal — not just that a member can read the tree, but that a
 *   stranger cannot, and that asking for the field by name does not get
 *   round it.
 *
 *   **A check that could not run is not a check that passed.** "An
 *   anonymous visitor cannot see Katarzyna" passes trivially if the public
 *   policy grants nothing at all. So the negative checks are gated on a
 *   positive one, and a gated check reports UNRUNNABLE, which fails the
 *   suite exactly like a failure does.
 *
 * The database half sabotages the live instance inside a transaction and
 * rolls it back, so each rule is proven to bite against real rows rather
 * than asserted to exist in a catalogue. One check opens two connections
 * and races them, because that is how the acyclicity trigger was beaten
 * once.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import {
  URL_BASE, DEMO_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD,
  DB_HOST, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD,
} from "./env.js";
import { COLLECTIONS } from "./authoring/index.js";
import {
  DOMAINS, BRAND_FOLDER, COLLECTION_COLOR, FOLDER_ICON,
  BOOKMARK_ICON, BOOKMARK_COLOR, BOOKMARK_TEXT_LIGHT, BOOKMARK_TEXT_DARK,
} from "./authoring/_theme.js";
import { deltaE, SEPARATION } from "./colour.js";
import { fromRoot } from "./root.js";

type State = "pass" | "fail" | "unrunnable";
type Result = { name: string; state: State; detail: string };
const results: Result[] = [];

function check(name: string, pass: boolean, detail = ""): void {
  results.push({ name, state: pass ? "pass" : "fail", detail });
}
function unrunnable(name: string, why: string): void {
  results.push({ name, state: "unrunnable", detail: why });
}
function section(title: string): void {
  results.push({ name: `── ${title}`, state: "pass", detail: "" });
}

/* ── http helpers ──────────────────────────────────────────────────────── */

async function login(email: string): Promise<string | null> {
  const res = await fetch(`${URL_BASE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { access_token: string } };
  return body.data?.access_token ?? null;
}

type Res = { status: number; data?: unknown; errors?: unknown };
type Row = Record<string, unknown>;

async function call(token: string | null, method: string, path: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = (await res.json().catch(() => ({}))) as Res;
  return { status: res.status, data: parsed.data, errors: parsed.errors };
}
const get = (token: string | null, path: string) => call(token, "GET", path);
const rows = (r: Res): Row[] => (Array.isArray(r.data) ? (r.data as Row[]) : []);
const names = (r: Res, key = "display_name"): string[] => rows(r).map((x) => String(x[key] ?? ""));
const has = (r: Res, key: string, value: string): boolean => names(r, key).includes(value);

/* ── the database rules ────────────────────────────────────────────────── */

const K = "8f1c0000-0000-4000-8000-00000000f001";
const F = "8f1c0000-0000-4000-8000-00000000f002";
const E = (n: string): string => `8f1c0000-0000-4000-8000-00000000e${n}`;

async function databaseRules(): Promise<void> {
  section("database rules, sabotaged and rolled back");
  const client = new Client({ host: DB_HOST, port: DB_PORT, database: DB_DATABASE, user: DB_USER, password: DB_PASSWORD });
  try {
    await client.connect();
  } catch (e) {
    unrunnable("the database rules", `cannot reach Postgres — ${e instanceof Error ? e.message : e}`);
    return;
  }

  const id = async (name: string): Promise<string | null> =>
    (await client.query<{ id: string }>("SELECT id FROM persons WHERE display_name = $1", [name])).rows[0]?.id ?? null;

  try {
    await client.query("BEGIN");
    const jan = await id("Jan Kowalski"), kat = await id("Katarzyna Kowalska"), tom = await id("Tomasz Kowalski"),
      zof = await id("Zofia Kowalska"), piotr = await id("Piotr Kowalski"), ham = await id("Hamish Fairbairn");
    if (!jan || !kat || !tom || !zof || !piotr || !ham) {
      unrunnable("the database rules", "the demo tree is not seeded — run `pnpm seed`");
      await client.query("ROLLBACK");
      return;
    }

    /** Runs a statement; null if allowed, the message if the database refused. */
    const attempt = async (sql: string, params: unknown[] = []): Promise<string | null> => {
      await client.query("SAVEPOINT s");
      try { await client.query(sql, params); await client.query("RELEASE SAVEPOINT s"); return null; }
      catch (e) { await client.query("ROLLBACK TO SAVEPOINT s"); return e instanceof Error ? e.message : String(e); }
    };
    const refused = async (name: string, sql: string, params: unknown[] = [], detail = "") =>
      check(name, (await attempt(sql, params)) !== null, detail);
    const allowed = async (name: string, sql: string, params: unknown[] = [], detail = "") => {
      const msg = await attempt(sql, params);
      check(name, msg === null, msg ? msg.slice(0, 70) : detail);
    };
    const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
      (await client.query(sql, params)).rows[0] as T;

    // Before any sabotage dirties the fixture: the data-quality view is quiet.
    const quiet = await one<{ n: string }>("SELECT count(*) AS n FROM data_issues WHERE tree = $1", [K]);
    check("the data-quality view finds nothing wrong with the demo tree", quiet.n === "0", `${quiet.n} issue(s)`);

    const EDGE = "INSERT INTO parentage (tree, parent, child, lineage) VALUES ($1, $2, $3, $4)";

    // The graph.
    await refused("a great-grandchild cannot parent the root", EDGE, [K, kat, jan, "birth"], "4-generation loop");
    await refused("a child cannot parent their own parent", EDGE, [K, tom, piotr, "birth"], "2-generation loop");
    await refused("nobody can be their own parent", EDGE, [K, jan, jan, "birth"]);
    await refused("an ADOPTIVE edge cannot close a loop either", EDGE, [K, kat, jan, "adoptive"]);
    await allowed("but a STEP edge may — \"I'm my own grandpa\" is a family, not an error", EDGE, [K, piotr, jan, "step"]);
    const second = (await one<{ id: string }>("INSERT INTO persons (tree, is_living) VALUES ($1, false) RETURNING id", [K])).id;
    check("and pedigree collapse is still allowed",
      (await attempt(EDGE, [K, tom, second, "birth"])) === null && (await attempt(EDGE, [K, zof, second, "birth"])) === null,
      "cousins' child descends from one couple twice");
    await allowed("an insert with no id gets one from the database", "INSERT INTO persons (tree, is_living) VALUES ($1, false)", [K]);
    await refused("the same couple cannot be recorded with the partners swapped",
      "INSERT INTO couples (tree, person_a, person_b) VALUES ($1, $2, $3)", [K, zof, tom], "(a,b) and (b,a) are one union");
    await refused("a connected person cannot be moved to another tree", "UPDATE persons SET tree = $1 WHERE id = $2", [F, jan]);
    await refused("a connected person cannot be deleted directly", "DELETE FROM persons WHERE id = $1", [jan]);
    const loner = (await one<{ id: string }>("INSERT INTO persons (tree, is_living) VALUES ($1, false) RETURNING id", [K])).id;
    await allowed("an unconnected one can", "DELETE FROM persons WHERE id = $1", [loner]);

    // Names.
    await client.query("INSERT INTO persons (id, tree, is_living) VALUES ('00000000-0000-4000-8000-00000000bbbb', $1, false)", [K]);
    await client.query("INSERT INTO person_names (tree, person, type, given, particle, surname) VALUES ($1, '00000000-0000-4000-8000-00000000bbbb', 'birth', 'Vincent', 'van', 'Gogh')", [K]);
    let vg = await one<{ display_name: string; sort_name: string }>("SELECT display_name, sort_name FROM persons WHERE id = '00000000-0000-4000-8000-00000000bbbb'");
    check("the shown name carries the particle", vg.display_name === "Vincent van Gogh", vg.display_name);
    check("and sorts under G when the tree ignores particles", vg.sort_name === "Gogh, Vincent van", vg.sort_name);
    await client.query("UPDATE trees SET particle_sorting = 'include' WHERE id = $1", [K]);
    vg = await one("SELECT display_name, sort_name FROM persons WHERE id = '00000000-0000-4000-8000-00000000bbbb'");
    check("and under V when the tree includes them", vg.sort_name === "van Gogh, Vincent", vg.sort_name);
    await client.query("UPDATE person_names SET name_order = 'surname_first' WHERE person = '00000000-0000-4000-8000-00000000bbbb'");
    vg = await one("SELECT display_name FROM persons WHERE id = '00000000-0000-4000-8000-00000000bbbb'");
    check("a surname-first name shows surname first", vg.display_name === "van Gogh Vincent", vg.display_name);
    const pid = await one<{ public_id: string }>("SELECT public_id FROM persons WHERE id = $1", [jan]);
    check("every person has an 8-character public id", /^[0-9a-hjkmnp-tv-z]{8}$/.test(pid.public_id ?? ""), pid.public_id);
    await refused("which cannot be changed", "UPDATE persons SET public_id = 'zzzzzzzz' WHERE id = $1", [jan]);

    // Trees.
    const admin = (await one<{ id: string }>("SELECT id FROM directus_users WHERE email = 'admin@stemma.dev'")).id;
    const ownerU = (await one<{ id: string }>("SELECT id FROM directus_users WHERE email = 'owner@stemma.example.com'")).id;
    await client.query("INSERT INTO trees (id, name, slug, owner) VALUES ('00000000-0000-4000-8000-00000000cccc', 'T', 'test-tree', $1)", [admin]);
    const m = await one<{ role: string }>("SELECT role FROM tree_members WHERE tree = '00000000-0000-4000-8000-00000000cccc' AND \"user\" = $1", [admin]);
    check("setting a tree's owner creates the owner membership", m?.role === "owner", m?.role ?? "no row");
    await refused("the only owner membership cannot be deleted", "DELETE FROM tree_members WHERE tree = '00000000-0000-4000-8000-00000000cccc' AND \"user\" = $1", [admin]);
    await refused("nor demoted", "UPDATE tree_members SET role = 'viewer' WHERE tree = '00000000-0000-4000-8000-00000000cccc' AND \"user\" = $1", [admin]);
    await client.query("INSERT INTO tree_members (tree, \"user\", role) VALUES ('00000000-0000-4000-8000-00000000cccc', $1, 'owner')", [ownerU]);
    await allowed("one of two owners can be demoted", "UPDATE tree_members SET role = 'viewer' WHERE tree = '00000000-0000-4000-8000-00000000cccc' AND \"user\" = $1", [admin]);
    await client.query("UPDATE trees SET owner = NULL WHERE id = '00000000-0000-4000-8000-00000000cccc'");
    const promoted = await one<{ owner: string }>("SELECT owner FROM trees WHERE id = '00000000-0000-4000-8000-00000000cccc'");
    check("a nulled owner is replaced by the remaining owner", promoted.owner === ownerU);
    await allowed("a never-public tree can change its slug", "UPDATE trees SET slug = 'renamed' WHERE id = '00000000-0000-4000-8000-00000000cccc'");
    await client.query("UPDATE trees SET is_public = true WHERE id = '00000000-0000-4000-8000-00000000cccc'");
    await refused("a tree that has been public cannot", "UPDATE trees SET slug = 'renamed-again' WHERE id = '00000000-0000-4000-8000-00000000cccc'");
    await refused("a reserved slug is refused", "INSERT INTO trees (name, slug) VALUES ('X', 'admin')");
    await client.query("INSERT INTO persons (id, tree, is_living) VALUES ('00000000-0000-4000-8000-00000000dddd', '00000000-0000-4000-8000-00000000cccc', false), ('00000000-0000-4000-8000-00000000eeee', '00000000-0000-4000-8000-00000000cccc', false)");
    await client.query("INSERT INTO parentage (tree, parent, child) VALUES ('00000000-0000-4000-8000-00000000cccc', '00000000-0000-4000-8000-00000000dddd', '00000000-0000-4000-8000-00000000eeee')");
    await allowed("deleting a whole tree cascades past prevent-delete and last-owner", "DELETE FROM trees WHERE id = '00000000-0000-4000-8000-00000000cccc'");

    // Events and dates.
    const birth = (await one<{ id: string }>("SELECT id FROM event_types WHERE code = 'birth' AND tree IS NULL")).id;
    const death = (await one<{ id: string }>("SELECT id FROM event_types WHERE code = 'death' AND tree IS NULL")).id;
    const census = (await one<{ id: string }>("SELECT id FROM event_types WHERE code = 'census' AND tree IS NULL")).id;
    const EV = "INSERT INTO events (tree, type, subject_person, subject_couple, date_original, date_qualifier, date_earliest, date_latest) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";
    await refused("an event cannot have two subjects", EV, [K, birth, jan, "8f1c0000-0000-4000-8000-00000000d001", null, null, null, null]);
    await refused("nor none", EV, [K, birth, null, null, null, null, null, null]);
    await client.query("INSERT INTO event_types (id, tree, code, label) VALUES ('00000000-0000-4000-8000-0000000e0004', $1, 'heimat', 'Heimat')", [F]);
    await refused("a type owned by another tree cannot be used", EV, [K, "00000000-0000-4000-8000-0000000e0004", jan, null, null, null, null, null]);
    await refused("two global types cannot share a code", "INSERT INTO event_types (code, label) VALUES ('birth', 'Birth again')");
    await allowed("'before 1900' is a latest bound alone", EV, [K, birth, jan, null, "bef 1900", "before", null, "1899-12-31"]);
    await allowed("a phrase date has no range at all", EV, [K, census, jan, null, "the winter grandmother died", "phrase", null, null]);
    await refused("'before' with an earliest bound is malformed", EV, [K, birth, jan, null, null, "before", "1850-01-01", "1899-12-31"]);
    await refused("a range cannot run backwards", EV, [K, birth, jan, null, null, "between", "1855-01-01", "1850-12-31"]);
    await refused("'exact' cannot carry a range", EV, [K, birth, jan, null, null, "exact", "1850-01-01", "1850-12-31"]);
    const conclusions = await one<{ n: string }>("SELECT count(*) AS n FROM events WHERE subject_person = $1 AND type = $2 AND is_conclusion", [jan, birth]);
    check("Jan has exactly one birth marked as the conclusion", conclusions.n === "1", `${conclusions.n}`);
    await refused("a second conclusion for the same fact is refused",
      "INSERT INTO events (tree, type, subject_person, date_qualifier, date_earliest, date_latest, is_conclusion) VALUES ($1, $2, $3, 'exact', '1882-03-01', '1882-03-01', true)", [K, birth, jan]);
    await client.query("UPDATE persons SET is_living = true, living_basis = 'unknown' WHERE id = $1", [zof]);
    await client.query(EV, [K, death, zof, null, "2020", "about", "2020-01-01", "2020-12-31"]);
    const z = await one<{ is_living: boolean; living_basis: string }>("SELECT is_living, living_basis FROM persons WHERE id = $1", [zof]);
    check("a death event ends a life", !z.is_living && z.living_basis === "death_record", `living=${z.is_living} basis=${z.living_basis}`);
    const c2011 = await one<{ has_living_participant: boolean }>("SELECT has_living_participant FROM events WHERE id = $1", [E("125")]);
    check("a census with a living household member knows it", c2011.has_living_participant === true);
    await client.query("DELETE FROM event_participants WHERE event = $1 AND person = $2", [E("125"), kat]);
    const c2011b = await one<{ has_living_participant: boolean }>("SELECT has_living_participant FROM events WHERE id = $1", [E("125")]);
    check("and forgets when they are removed", c2011b.has_living_participant === false);

    // Places.
    await refused("a place cannot be inside its own child",
      "UPDATE places SET parent_place = '8f1c0000-0000-4000-8000-00000000b102' WHERE id = '8f1c0000-0000-4000-8000-00000000b101'");
    const gd = await one<{ has_public_reference: boolean }>("SELECT has_public_reference FROM places WHERE id = '8f1c0000-0000-4000-8000-00000000b102'");
    check("Gdańsk, where dead people were born, is publicly referenced", gd.has_public_reference === true);
    const dl = await one<{ has_public_reference: boolean }>("SELECT has_public_reference FROM places WHERE id = '8f1c0000-0000-4000-8000-00000000b106'");
    check("ul. Długa 12, known only from a living person's residence, is not", dl.has_public_reference === false);

    // Evidence.
    await refused("a citation cannot point at a person in another tree",
      "INSERT INTO citation_links (tree, citation, collection, item) VALUES ($1, '8f1c0000-0000-4000-8000-00000000f301', 'persons', $2)", [K, ham]);
    await refused("nor at a collection the model does not know",
      "INSERT INTO citation_links (tree, citation, collection, item) VALUES ($1, '8f1c0000-0000-4000-8000-00000000f301', 'trees', $2)", [K, K]);
    const l1 = await one<{ is_public_ok: boolean }>("SELECT is_public_ok FROM citation_links WHERE id = '8f1c0000-0000-4000-8000-00000000f402'");
    check("a link to dead Jan is public", l1.is_public_ok === true);
    const l9 = await one<{ is_public_ok: boolean }>("SELECT is_public_ok FROM citation_links WHERE id = '8f1c0000-0000-4000-8000-00000000f409'");
    check("a link to living Katarzyna is not", l9.is_public_ok === false);
    await client.query("UPDATE persons SET is_living = false WHERE id = $1", [kat]);
    const l9b = await one<{ is_public_ok: boolean }>("SELECT is_public_ok FROM citation_links WHERE id = '8f1c0000-0000-4000-8000-00000000f409'");
    check("until she is recorded dead — the change fans out", l9b.is_public_ok === true);

    // The data-quality view: silent on the clean fixture (checked before any
    // sabotage above dirtied it), so prove it speaks.
    await client.query("UPDATE events SET date_qualifier = 'about', date_earliest = '1990-01-01', date_latest = '1990-12-31', date_original = '1990' WHERE id = $1", [E("113")]);
    const loud = await one<{ kinds: string }>(
      "SELECT string_agg(DISTINCT kind, ', ' ORDER BY kind) AS kinds FROM data_issues WHERE tree = $1", [K]);
    check("but flags a daughter born 38 years after her father died, twice over",
      (loud.kinds ?? "").includes("born_after_parent_death") && (loud.kinds ?? "").includes("parent_age"), loud.kinds ?? "nothing");

    await client.query("ROLLBACK");
  } catch (e) {
    unrunnable("the database rules", e instanceof Error ? e.message : String(e));
    await client.query("ROLLBACK").catch(() => {});
  } finally {
    await client.end();
  }

  await theRace();
}

/**
 * Two connections, each inserting one half of a cycle, with the first
 * holding its transaction open. Under READ COMMITTED and no lock both
 * committed and the table held a cycle. With the lock the second waits,
 * then sees the first's edge and refuses.
 */
async function theRace(): Promise<void> {
  const mk = () => new Client({ host: DB_HOST, port: DB_PORT, database: DB_DATABASE, user: DB_USER, password: DB_PASSWORD });
  const setup = mk(), s1 = mk(), s2 = mk();
  try {
    await Promise.all([setup.connect(), s1.connect(), s2.connect()]);
    const a = (await setup.query<{ id: string }>("INSERT INTO persons (tree, is_living) VALUES ($1, false) RETURNING id", [K])).rows[0]!.id;
    const b = (await setup.query<{ id: string }>("INSERT INTO persons (tree, is_living) VALUES ($1, false) RETURNING id", [K])).rows[0]!.id;
    const EDGE = "INSERT INTO parentage (tree, parent, child, lineage) VALUES ($1, $2, $3, 'birth')";
    await s1.query("BEGIN");
    await s1.query(EDGE, [K, a, b]);
    await s2.query("BEGIN");
    const second = s2.query(EDGE, [K, b, a]).then(() => null, (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 400));
    await s1.query("COMMIT");
    const outcome = await second;
    await s2.query("ROLLBACK").catch(() => {});
    const edges = (await setup.query("SELECT count(*)::int AS n FROM parentage WHERE (parent = $1 AND child = $2) OR (parent = $2 AND child = $1)", [a, b])).rows[0] as { n: number };
    check("two racing sessions cannot insert the two halves of a cycle",
      outcome !== null && edges.n === 1, outcome ? "second waited on the lock, then was refused" : "BOTH COMMITTED — a cycle is in the table");
    await setup.query("DELETE FROM parentage WHERE parent IN ($1, $2) OR child IN ($1, $2)", [a, b]);
    await setup.query("DELETE FROM persons WHERE id IN ($1, $2)", [a, b]);
  } catch (e) {
    unrunnable("two racing sessions cannot insert the two halves of a cycle", e instanceof Error ? e.message : String(e));
  } finally {
    await Promise.all([setup.end(), s1.end(), s2.end()]).catch(() => {});
  }
}

/* ── the public boundary ───────────────────────────────────────────────── */

async function publicBoundary(): Promise<void> {
  section("the public boundary, as an anonymous visitor");
  const anon = null;

  const people = await get(anon, "/items/persons?limit=-1&fields=id,display_name,is_living,biography");
  const visible = names(people);
  const publicReadWorks = people.status === 200 && visible.includes("Jan Kowalski");

  check("an anonymous visitor can read the dead of a public tree", publicReadWorks,
    people.status === 200 ? `saw ${visible.length}: ${visible.slice(0, 3).join(", ")}…` : `HTTP ${people.status}`);

  // The gate. Every absence below proves nothing unless presence was shown.
  const gate = (name: string, pass: boolean, detail = "") =>
    publicReadWorks ? check(name, pass, detail) : unrunnable(name, "the public read returns nothing, so this would pass for the wrong reason");

  gate("and CANNOT see the living one", !visible.includes("Katarzyna Kowalska"));
  gate("nor by asking for living people explicitly", names(await get(anon, "/items/persons?filter[is_living][_eq]=true&fields=display_name")).length === 0);
  gate("nor by her id", (await get(anon, "/items/persons/8f1c0000-0000-4000-8000-00000000a007")).status === 403);
  gate("and cannot see a DEAD person in a PRIVATE tree", !visible.includes("Hamish Fairbairn"));
  gate("is never handed research notes", !rows(people).some((p) => "notes" in p));
  gate("but does get a biography", rows(people).some((p) => p["display_name"] === "Jan Kowalski" && p["biography"]));

  const edges = await get(anon, "/items/parentage?limit=-1&fields=parent.display_name,child.display_name");
  const touchesKat = rows(edges).some((e) => [e["parent"], e["child"]].some((x) => (x as Row | null)?.["display_name"] === "Katarzyna Kowalska"));
  gate("cannot see an edge naming the living person's parents", !touchesKat, `${rows(edges).length} edges visible`);
  gate("but sees the adoption edge like any other", rows(edges).some((e) => (e["child"] as Row | null)?.["display_name"] === "Wojciech Kowalski"));
  gate("cannot see her name", !has(await get(anon, "/items/person_names?limit=-1&fields=given"), "given", "Katarzyna"));
  gate("but sees both of Maria's", names(await get(anon, "/items/person_names?limit=-1&fields=surname&filter[person][_eq]=8f1c0000-0000-4000-8000-00000000a002"), "surname").sort().join("+") === "Kowalska+Wiśniewska");

  const events = await get(anon, "/items/events?limit=-1&fields=id,type.code,subject_person.display_name,date_original,is_conclusion");
  const ev = rows(events);
  const janBirths = ev.filter((e) => (e["subject_person"] as Row | null)?.["display_name"] === "Jan Kowalski" && (e["type"] as Row)?.["code"] === "birth");
  gate("sees BOTH of Jan's conflicting births — evidence is displayed, not suppressed", janBirths.length === 2, `${janBirths.length} births, ${janBirths.filter((e) => e["is_conclusion"]).length} marked conclusion`);
  gate("cannot see the living person's birth", !ev.some((e) => (e["subject_person"] as Row | null)?.["display_name"] === "Katarzyna Kowalska"));
  gate("cannot see the 2011 census she is a household member of", !ev.some((e) => e["id"] === E("125")), "has_living_participant hides the whole event");
  gate("but sees the 1921 census, whose household is all dead now", ev.some((e) => e["id"] === E("108")));
  gate("sees the marriage, a couple event", ev.some((e) => e["id"] === E("107")));
  const parts = await get(anon, "/items/event_participants?limit=-1&fields=person.display_name,role");
  gate("sees the wedding witness", rows(parts).some((p) => (p["person"] as Row)?.["display_name"] === "Stanisław Wiśniewski"));
  gate("but not the living household member", !rows(parts).some((p) => (p["person"] as Row | null)?.["display_name"] === "Katarzyna Kowalska"));

  const places = await get(anon, "/items/places?limit=-1&fields=name");
  gate("sees Gdańsk", has(places, "name", "Gdańsk"));
  gate("cannot see the living person's street", !has(places, "name", "ul. Długa 12"));
  gate("sees the place's historical name", has(await get(anon, "/items/place_names?limit=-1&fields=name"), "name", "Danzig"));

  const cits = await get(anon, "/items/citations?limit=-1&fields=id,locator,evidence");
  gate("sees the citations behind Jan, including the negative search", rows(cits).some((c) => c["evidence"] === "negative"), `${rows(cits).length} citations`);
  gate("but not the one that supports only the living person", !rows(cits).some((c) => c["id"] === "8f1c0000-0000-4000-8000-00000000f307"));
  gate("sees the event vocabulary", rows(await get(anon, "/items/event_types?limit=-1&fields=code")).length > 40);

  const trees = await get(anon, "/items/trees?limit=-1&fields=slug,is_public");
  gate("sees the public tree and not the private one", has(trees, "slug", "kowalski") && !has(trees, "slug", "fairbairn"));
  check("an anonymous visitor cannot write", (await call(anon, "POST", "/items/persons", { tree: K })).status !== 200);
  gate("and cannot read memberships", rows(await get(anon, "/items/tree_members?limit=-1")).length === 0);
}

/* ── membership ────────────────────────────────────────────────────────── */

async function membership(): Promise<void> {
  section("membership, as each demo account");
  const owner = await login("owner@stemma.example.com");
  const cousin = await login("cousin@stemma.example.com");
  const stranger = await login("stranger@stemma.example.com");
  if (!owner) { unrunnable("the membership model", "cannot sign in as owner@stemma.example.com — run `pnpm seed`"); return; }

  const mine = await get(owner, "/items/persons?limit=-1&fields=display_name,notes");
  const memberReadWorks = mine.status === 200 && names(mine).length > 0;
  check("a member reads their own tree, including the living", memberReadWorks && has(mine, "display_name", "Katarzyna Kowalska"),
    mine.status === 200 ? `${names(mine).length} people` : `HTTP ${mine.status}`);
  const gate = (name: string, pass: boolean, detail = "") =>
    memberReadWorks ? check(name, pass, detail) : unrunnable(name, "the member read returns nothing");
  gate("and the research notes", rows(mine).some((p) => p["display_name"] === "Katarzyna Kowalska" && p["notes"]));
  gate("but not another tree", !has(mine, "display_name", "Hamish Fairbairn"));
  gate("sees the 2011 census the public cannot", rows(await get(owner, `/items/events?filter[id][_eq]=${E("125")}`)).length === 1);
  gate("and the living person's street", has(await get(owner, "/items/places?limit=-1&fields=name"), "name", "ul. Długa 12"));

  if (!cousin) unrunnable("a contributor may add but not change or delete", "cannot sign in as cousin@stemma.example.com");
  else {
    const add = await call(cousin, "POST", "/items/persons", { tree: K, is_living: false });
    check("a contributor may add a person", add.status === 200, `HTTP ${add.status}`);
    const made = (add.data as Row | undefined)?.["id"] as string | undefined;
    if (made) {
      check("but may NOT change one", (await call(cousin, "PATCH", `/items/persons/${made}`, { biography: "x" })).status === 403);
      check("nor delete one", (await call(cousin, "DELETE", `/items/persons/${made}`)).status === 403);
      check("an owner may", (await call(owner, "DELETE", `/items/persons/${made}`)).status === 204);
    } else unrunnable("but may NOT change or delete one", "the create did not return an id");
    const elsewhere = await call(cousin, "POST", "/items/persons", { tree: F, is_living: false });
    check("a contributor cannot add to a tree they are not in", elsewhere.status !== 200, `HTTP ${elsewhere.status}`);
    // The stranger owns the Fairbairns; lend them viewer standing on the
    // Kowalskis for one check, then take it back.
    const viewer = await login("stranger@stemma.example.com");
    const viewerId = viewer ? ((await get(viewer, "/users/me?fields=id")).data as Row | undefined)?.["id"] : undefined;
    if (viewer && viewerId) {
      const vm = await call(owner, "POST", "/items/tree_members", { tree: K, user: viewerId, role: "viewer" });
      const asViewer = await call(viewer, "POST", "/items/persons", { tree: K, is_living: false });
      check("a viewer cannot add either", asViewer.status !== 200, `HTTP ${asViewer.status}`);
      const vmId = (vm.data as Row | undefined)?.["id"];
      if (vmId) await call(owner, "DELETE", `/items/tree_members/${vmId}`);
    }
    check("nor invent a person in no tree", (await call(cousin, "POST", "/items/persons", { is_living: false })).status !== 200);
  }

  if (!stranger) unrunnable("an outsider sees nothing of a tree they do not belong to", "the third demo account does not exist");
  else {
    const theirs = await get(stranger, "/items/persons?limit=-1&fields=display_name");
    check("an outsider sees nothing of a tree they do not belong to", !has(theirs, "display_name", "Jan Kowalski"), `${names(theirs).length} visible`);
    check("but does see their own private tree's dead", has(theirs, "display_name", "Hamish Fairbairn"));
    check("and cannot read the public tree's members", rows(await get(stranger, `/items/tree_members?filter[tree][_eq]=${K}`)).length === 0);
  }

  // Event types: global rows are admin-owned.
  const global = (await get(owner, "/items/event_types?filter[code][_eq]=birth&filter[tree][_null]=true&fields=id")).data as Row[] | undefined;
  if (global?.[0]) {
    check("a member cannot edit a global event type", (await call(owner, "PATCH", `/items/event_types/${global[0]["id"]}`, { label: "x" })).status === 403);
    check("nor create one", (await call(owner, "POST", "/items/event_types", { code: "x", label: "x" })).status !== 200);
    const own = await call(owner, "POST", "/items/event_types", { tree: K, code: "heimat", label: "Heimat" });
    check("but may add their tree's own", own.status === 200, `HTTP ${own.status}`);
    const ownId = (own.data as Row | undefined)?.["id"];
    if (ownId) await call(owner, "DELETE", `/items/event_types/${ownId}`);
  }

  // Making a tree: the preset sets the owner, the trigger makes the membership.
  const made = await call(cousin ?? owner, "POST", "/items/trees", { name: "Bartek's tree", slug: `bartek-${Date.now().toString(36)}` });
  check("a signed-in user can make a tree", made.status === 200, `HTTP ${made.status}`);
  const treeId = (made.data as Row | undefined)?.["id"] as string | undefined;
  if (treeId) {
    const own = await get(cousin ?? owner, `/items/tree_members?filter[tree][_eq]=${treeId}&fields=role`);
    check("and is its owner without asking", rows(own).some((m) => m["role"] === "owner"));
    check("and may delete it", (await call(cousin ?? owner, "DELETE", `/items/trees/${treeId}`)).status === 204);
  }
}

/* ── what the README says about itself ──────────────────────────────── */

/**
 * The README is a claim, so it gets checked like one.
 *
 * A number in a README rots the moment somebody adds a collection, and a
 * project whose front page overstates itself is worse than one that says
 * nothing — particularly this project, whose whole argument is that a
 * check which cannot fail is decoration. So every figure it quotes is
 * asserted against the instance that is actually running.
 *
 * Only durable claims live here. The performance table is measured by a
 * different tool on a synthetic tree and is dated in the text; asserting
 * it from this suite would make the numbers a hostage to whatever laptop
 * ran it last.
 */
/** The admin, for the checks that read configuration rather than content. */
async function adminToken(): Promise<string | null> {
  const res = await fetch(`${URL_BASE}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { access_token: string } };
  return body.data?.access_token ?? null;
}

/* ── the admin surface ─────────────────────────────────────────────────── */

/**
 * The Data Studio is a deliverable, not a debug console.
 *
 * Everything here was written after a single brace in a single field note
 * took out every label in the admin at once. `directus_translations` is
 * merged into vue-i18n escaping only `@ $ |`, so `{` and `}` stay live and
 * the value is compiled as a message with placeholders. One note read "A
 * list of {type, value}", the compile threw, and the throw landed inside
 * `loadLanguage`'s bare `catch {}` — which meant `translateFields()` never
 * ran, every `$t:` key in the instance rendered raw, and `person_names`,
 * the one collection carrying that note, rendered an **empty form**,
 * because the same SyntaxError surfaced again during render and took the
 * subtree with it.
 *
 * Nothing failed. No request 500'd, no log line appeared, and the suite
 * was green throughout. That is the argument for checking presentation
 * the same way this file checks permissions.
 */
async function adminSurface(): Promise<void> {
  section("the admin surface");

  const admin = await adminToken();

  if (!admin) {
    for (const n of [
      "every translation compiles as a message", "every $t: key a field names exists",
      "the audit columns are not raw uuids", "every collection sits in a domain folder",
      "the global bookmarks are installed", "and they do not read as collections",
    ]) unrunnable(n, "cannot log in as the admin — check ADMIN_EMAIL and ADMIN_PASSWORD");
  } else {
    /* 1. the bug above, as a rule. */
    const translations = rows(await get(admin, "/translations?limit=-1&fields=key,value,language"));
    const braced = translations.filter((t) => /[{}]/.test(String(t["value"] ?? "")));
    check("every translation compiles as a message",
      translations.length > 0 && braced.length === 0,
      translations.length === 0
        ? "no translations are installed at all — run `pnpm build`"
        : braced.length === 0
          ? `${translations.length} values, none with a brace`
          : `${braced.length} contain a brace, which vue-i18n reads as a placeholder: ${braced.map((t) => t["key"]).join(", ")}`);

    /* 2. a key that resolves to itself is as bad as one that throws. */
    const fields = rows(await get(admin, "/fields?limit=-1"));
    const stored = new Set(translations.map((t) => String(t["key"])));
    const referenced = new Set<string>();
    const walk = (v: unknown): void => {
      if (typeof v === "string") { for (const m of v.matchAll(/\$t:([A-Za-z0-9_.-]+)/g)) if (m[1]) referenced.add(m[1]); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x); return; }
      if (v && typeof v === "object") { for (const x of Object.values(v)) walk(x); }
    };
    // Ours only. Directus's own fields carry keys like
    // `field_options.directus_activity.create`, which ship inside the
    // app's i18n bundle and are not rows in `directus_translations` —
    // scanning them reports 209 phantom failures and says nothing about
    // this schema.
    const allCollections = rows(await get(admin, "/collections?limit=-1"));
    const mine = (c: Row): boolean => !String(c["collection"] ?? "").startsWith("directus_");
    walk(fields.filter(mine));
    walk(allCollections.filter(mine));
    const missing = [...referenced].filter((k) => !stored.has(k));
    check("every $t: key a field names exists",
      referenced.size > 0 && missing.length === 0,
      referenced.size === 0 ? "no $t: keys are in use, so this proves nothing"
        : missing.length === 0 ? `${referenced.size} keys, all present`
        : `${missing.length} missing: ${missing.slice(0, 6).join(", ")}`);

    /* 3. the commonest way an instance looks unfinished. */
    const AUDIT = ["user_created", "user_updated", "date_created", "date_updated", "id"];
    const ours = fields.filter((f) => !String(f["collection"]).startsWith("directus_"));
    const undisplayed = ours.filter((f) => {
      const meta = (f["meta"] ?? {}) as Record<string, unknown>;
      return AUDIT.includes(String(f["field"])) && !meta["display"];
    });
    check("the audit columns are not raw uuids",
      ours.length > 0 && undisplayed.length === 0,
      undisplayed.length === 0
        ? `${AUDIT.length} columns x ${COLLECTIONS.length} collections, all with a display`
        : `${undisplayed.length} render raw: ${undisplayed.slice(0, 5).map((f) => `${f["collection"]}.${f["field"]}`).join(", ")}`);

    /* 4. the grouping, and the one colour. A collection quietly given a
       hue of its own is the drift this catches — the sidebar was six
       colours once and reading it was worse, not better. */
    const byName = new Map(allCollections.map((c) => [String(c["collection"]), (c["meta"] ?? {}) as Record<string, unknown>]));
    const folders = new Set(Object.values(DOMAINS).map((d) => d.folder));
    const stray = COLLECTIONS.filter((c) => {
      const meta = byName.get(c.collection);
      const group = String(meta?.["group"] ?? "");
      return !meta || !folders.has(group) || String(meta["color"] ?? "") !== COLLECTION_COLOR;
    });
    const present = [...folders].filter((f) => byName.has(f));
    const wrongIcon = present.filter((f) => byName.get(f)?.["icon"] !== FOLDER_ICON);
    check("every collection sits in a domain folder",
      present.length === folders.size && stray.length === 0 && wrongIcon.length === 0,
      present.length !== folders.size
        ? `${folders.size - present.length} folder(s) absent`
        : wrongIcon.length
          ? `${wrongIcon.length} folder(s) are not the "${FOLDER_ICON}" icon: ${wrongIcon.join(", ")}`
          : stray.length
            ? `${stray.length} misfiled or off-colour: ${stray.slice(0, 4).map((c) => c.collection).join(", ")}`
            : `${COLLECTIONS.length} collections in ${folders.size} folders, all ${COLLECTION_COLOR}`);

    /* 5. a bookmark pointing at nothing is worse than no bookmark — and
       every one of them is the same icon in the same colour, which is the
       inverse of the rule the collections follow. Giving each its own hue
       was tried and answers a question nobody asks: the label already
       says which bookmark it is. */
    const presets = rows(await get(admin, "/presets?limit=-1&fields=id,bookmark,collection,user,role,icon,color"));
    const globals = presets.filter((p) => p["user"] === null && p["role"] === null && p["bookmark"]);
    const dangling = globals.filter((p) => !byName.has(String(p["collection"])));
    const offIcon = globals.filter((p) => p["icon"] !== BOOKMARK_ICON);
    const offColour = globals.filter((p) => p["color"] !== BOOKMARK_COLOR);
    check("the global bookmarks are installed",
      globals.length > 0 && dangling.length === 0 && offIcon.length === 0 && offColour.length === 0,
      globals.length === 0 ? "none — run `pnpm presets`"
        : dangling.length ? `${dangling.length} name a collection that does not exist`
        : offIcon.length ? `${offIcon.length} do not use the "${BOOKMARK_ICON}" icon`
        : offColour.length ? `${offColour.length} are not ${BOOKMARK_COLOR}`
        : `${globals.length} bookmarks, all "${BOOKMARK_ICON}" in ${BOOKMARK_COLOR}`);

    /* 6. and they do not read as collections. Three halves, really: the
       icon colour has to be far enough from the collections' to register
       as a different kind of row; the label has to be coloured too,
       which no theme rule can express, so it is `custom_css`, and an
       empty one would leave the thing half-applied with nothing
       complaining; and that CSS has to stay **scoped**. There is no DOM
       hook for global-vs-personal — the two anchors render identically —
       so the selector keys off the preset's own colour with `:has()`,
       and a rule that lost the `:has()` would quietly restyle every
       contributor's private bookmarks too. */
    const apart = deltaE(BOOKMARK_COLOR, COLLECTION_COLOR);
    const settings = (await get(admin, "/settings?fields=custom_css")).data as Record<string, unknown> | undefined;
    const css = String(settings?.["custom_css"] ?? "");
    const styled = css.includes(".bookmark")
      && css.includes(BOOKMARK_TEXT_LIGHT) && css.includes(BOOKMARK_TEXT_DARK);
    const scoped = css.includes(":has(") && css.includes(BOOKMARK_COLOR);
    check("and they do not read as collections",
      apart >= SEPARATION && styled && scoped,
      apart < SEPARATION
        ? `bookmark ${BOOKMARK_COLOR} is only dE ${apart.toFixed(1)} from collection ${COLLECTION_COLOR}`
        : !css ? "custom_css is empty, so the bookmark labels are the default foreground — run `pnpm brand`"
        : !styled ? "custom_css does not carry both label colours for .bookmark"
        : !scoped ? `custom_css is not scoped by :has() to ${BOOKMARK_COLOR} — it would restyle personal bookmarks too`
        : `dE ${apart.toFixed(1)} apart; custom_css colours the label in both appearances, scoped to our own`);
  }

  /* 7. branding, as an anonymous visitor sees it on the login screen. */
  const info = (await get(null, "/server/info")).data as { project?: Record<string, unknown> } | undefined;
  const project = info?.project ?? {};
  const named = project["project_name"] !== "Directus" && !!project["project_name"];
  const logo = project["project_logo"] ? String(project["project_logo"]) : null;
  check("the instance is branded to an anonymous caller",
    named && !!logo && !!project["public_favicon"] && !!project["public_note"],
    `name ${String(project["project_name"])}, colour ${String(project["project_color"])}, ` +
    `logo ${logo ? "set" : "MISSING"}, favicon ${project["public_favicon"] ? "set" : "MISSING"}`);

  /* 8. and the bytes load without a token, or the login screen is broken. */
  if (!logo) {
    unrunnable("the logo loads with no token", "no project_logo is set, so there is nothing to fetch");
  } else {
    const res = await fetch(`${URL_BASE}/assets/${logo}`);
    check("the logo loads with no token", res.status === 200,
      `GET /assets/${logo.slice(0, 8)} answered ${res.status} — branding lives in the "${BRAND_FOLDER}" folder, which the public policy names`);
  }

  /* 9. the other direction. Opening the brand folder to anonymous
     callers must not have opened anything else, so the set a stranger can
     see is compared against the set the policy describes — not against a
     hand-picked file, which only ever proves something about that file. */
  if (!admin) {
    unrunnable("and nothing else does", "needs the admin to compute what should be visible");
  } else {
    const all = rows(await get(admin, "/files?limit=-1&fields=id,title,is_public_ok,folder.name,tree.is_public"));
    const shouldSee = new Set(all.filter((f) => {
      const folder = (f["folder"] ?? {}) as Record<string, unknown>;
      const tree = (f["tree"] ?? {}) as Record<string, unknown>;
      return folder["name"] === BRAND_FOLDER || (f["is_public_ok"] === true && tree["is_public"] === true);
    }).map((f) => String(f["id"])));
    const canSee = new Set(rows(await get(null, "/files?limit=-1&fields=id")).map((f) => String(f["id"])));
    const extra = [...canSee].filter((id) => !shouldSee.has(id));
    const short = [...shouldSee].filter((id) => !canSee.has(id));
    check("and nothing else does",
      all.length > 0 && shouldSee.size > 0 && extra.length === 0 && short.length === 0,
      all.length === 0 ? "there are no files to reason about"
        : extra.length ? `${extra.length} file(s) a stranger can read that the policy does not describe`
        : short.length ? `${short.length} file(s) the policy permits but a stranger cannot read`
        : `${canSee.size} of ${all.length} files, exactly the ${shouldSee.size} the policy names`);
  }
}

/* ── the date parser ───────────────────────────────────────────────────── */

/**
 * The hook that turns `abt 1850` into four columns.
 *
 * Checked end to end through the API rather than by unit-testing the
 * parser, because the thing that can break is not the arithmetic — it is
 * the wiring. An extension that failed to build, a `dist/` that was never
 * rebuilt after an edit, a collection added to `dated()` and never added
 * to the hook's list: all of those leave a parser that is perfectly
 * correct and never runs. So this writes a real row and reads back what
 * landed.
 */
async function dateParser(): Promise<void> {
  section("the date parser");

  const admin = await adminToken();
  if (!admin) {
    for (const n of ["the hook fills the derived columns", "and a hand correction survives it",
                     "every dated collection is covered"]) {
      unrunnable(n, "cannot log in as the admin");
    }
    return;
  }

  // An event needs a tree, a type and exactly one subject — `events_one_subject`.
  const tree = rows(await get(admin, "/items/trees?limit=1&fields=id"))[0]?.["id"];
  const type = rows(await get(admin, "/items/event_types?limit=1&fields=id&filter[code][_eq]=birth"))[0]?.["id"];
  const who = tree
    ? rows(await get(admin, `/items/persons?limit=1&fields=id&filter[tree][_eq]=${String(tree)}`))[0]?.["id"]
    : undefined;

  if (!tree || !type || !who) {
    unrunnable("the hook fills the derived columns", "the demo tree is not seeded — run `pnpm seed`");
    unrunnable("and a hand correction survives it", "the demo tree is not seeded — run `pnpm seed`");
  } else {
    const made: string[] = [];
    try {
      const created = await call(admin, "POST", "/items/events",
        { tree, type, subject_person: who, date_original: "abt 1850" });
      const row = (created.data ?? {}) as Row;
      if (row["id"]) made.push(String(row["id"]));

      check("the hook fills the derived columns",
        row["date_qualifier"] === "about"
        && row["date_earliest"] === "1845-01-01" && row["date_latest"] === "1855-12-31",
        row["id"]
          ? `"abt 1850" became ${String(row["date_qualifier"])} ${String(row["date_earliest"])}..${String(row["date_latest"])}`
          : `the event could not be created (HTTP ${created.status}) — is the extension built?`);

      // The derived columns are meant to be correctable. A payload that
      // sets them explicitly must win over the parser, or a researcher
      // who narrowed a range from the parish register loses it on the
      // next save.
      if (!row["id"]) {
        unrunnable("and a hand correction survives it", "no row to correct");
      } else {
        const patched = await call(admin, "PATCH", `/items/events/${String(row["id"])}`, {
          date_original: "abt 1850", date_qualifier: "about",
          date_earliest: "1849-01-01", date_latest: "1851-12-31",
        });
        const after = (patched.data ?? {}) as Row;
        check("and a hand correction survives it",
          after["date_earliest"] === "1849-01-01" && after["date_latest"] === "1851-12-31",
          `narrowed to ${String(after["date_earliest"])}..${String(after["date_latest"])}; ` +
          "the parser alone would have said 1845-01-01..1855-12-31");
      }
    } finally {
      for (const id of made) await call(admin, "DELETE", `/items/events/${id}`);
    }
  }

  /*
   * The hook names its collections in a literal, because an extension
   * cannot import from the bootstrap package. That literal is the thing
   * most likely to go stale: add `dated()` to a new collection and the
   * dates there are silently never parsed, with nothing failing. So the
   * two lists are compared — the hook's, read out of its source, against
   * the collections that actually have a `date_original` column.
   */
  let declared: string[] = [];
  try {
    const src = readFileSync(fromRoot("extensions/directus-extension-date-parser/src/index.ts"), "utf8");
    const list = /const DATED = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
    declared = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as string);
  } catch {
    unrunnable("every dated collection is covered", "the date-parser extension is not where it should be");
    return;
  }

  const dated = rows(await get(admin, "/fields?limit=-1&fields=collection,field"))
    .filter((f) => f["field"] === "date_original")
    .map((f) => String(f["collection"]))
    .sort();
  const missing = dated.filter((c) => !declared.includes(c));
  const extra = declared.filter((c) => !dated.includes(c));
  check("every dated collection is covered",
    dated.length > 0 && missing.length === 0 && extra.length === 0,
    dated.length === 0 ? "no collection has a date_original column, so this proves nothing"
      : missing.length ? `the hook does not cover ${missing.join(", ")} — their dates are never parsed`
      : extra.length ? `the hook names ${extra.join(", ")}, which has no date_original`
      : `${dated.length} collections: ${dated.join(", ")}`);
}

/* ── GEDCOM export ─────────────────────────────────────────────────────── */

/**
 * The export, checked as a file rather than as a function.
 *
 * Two things can go wrong and only one of them is about genealogy. The
 * first is malformed output — a level that jumps by two, a pointer to a
 * record that was filtered away, a missing `TRLR` — none of which throws
 * anything server-side; the file downloads happily and the receiving
 * program rejects it. The second is a privacy leak, because the export
 * is the one route that hands a caller a whole tree in one request.
 *
 * So the structure is parsed back, and the anonymous copy is compared
 * against the authenticated one for a person who must not be in it.
 */
async function gedcomExport(): Promise<void> {
  section("GEDCOM export");

  const admin = await adminToken();
  const publicTree = admin
    ? rows(await get(admin, "/items/trees?limit=1&fields=slug&filter[is_public][_eq]=true"))[0]?.["slug"]
    : undefined;

  if (!admin || !publicTree) {
    for (const n of ["the export is well-formed GEDCOM 7", "every pointer in it resolves",
                     "and an anonymous export omits the living"]) {
      unrunnable(n, admin ? "no public tree is seeded — run `pnpm seed`" : "cannot log in as the admin");
    }
    return;
  }
  const slug = String(publicTree);

  const fetchGed = async (token: string | null): Promise<{ status: number; body: string }> => {
    const res = await fetch(`${URL_BASE}/gedcom/${slug}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: await res.text() };
  };

  const full = await fetchGed(admin);
  if (full.status !== 200) {
    for (const n of ["the export is well-formed GEDCOM 7", "every pointer in it resolves"]) {
      unrunnable(n, `GET /gedcom/${slug} answered ${full.status} — is the extension built?`);
    }
  } else {
    /*
     * GEDCOM's grammar is two rules deep: every line is
     * `<level> [<@xref@>] <TAG> [payload]`, and a level may only ever be
     * one deeper than the line above it. Almost every malformed file
     * fails one of those, and neither is expensive to check.
     */
    const lines = full.body.split("\r\n").filter((l) => l !== "");
    const shape = /^(\d+) (?:(@[^@]+@) )?([A-Za-z0-9_]+)(?: (.*))?$/;
    const bad: string[] = [];
    let previous = -1;
    for (const line of lines) {
      const m = shape.exec(line);
      if (!m) { bad.push(`not a GEDCOM line: ${line.slice(0, 40)}`); continue; }
      const level = Number(m[1]);
      if (level > previous + 1) bad.push(`level jumps ${previous} → ${level}: ${line.slice(0, 40)}`);
      previous = level;
    }
    const head = lines[0] === "0 HEAD";
    const trlr = lines[lines.length - 1] === "0 TRLR";
    const seven = full.body.includes("\r\n2 VERS 7.0\r\n");
    const crlf = full.body.includes("\r\n") && !/[^\r]\n/.test(full.body);

    check("the export is well-formed GEDCOM 7",
      bad.length === 0 && head && trlr && seven && crlf,
      !head ? "does not begin with 0 HEAD"
        : !trlr ? "does not end with 0 TRLR"
        : !seven ? "does not declare 2 VERS 7.0"
        : !crlf ? "has a bare LF somewhere; GEDCOM lines end CRLF"
        : bad.length ? `${bad.length} malformed: ${bad[0]}`
        : `${lines.length} lines, ${(full.body.match(/\r\n0 @/g) ?? []).length} records`);

    // A pointer to a record that is not in the file is the failure mode
    // reading through permissions invites: filter a parent out and the
    // child keeps pointing at them.
    const defined = new Set([...full.body.matchAll(/\r\n0 (@[^@]+@) /g)].map((m) => m[1] as string));
    const used = new Set([...full.body.matchAll(/\r\n\d+ (?:HUSB|WIFE|CHIL|FAMS|FAMC|SOUR|REPO|OBJE|NOTE) (@[^@]+@)/g)]
      .map((m) => m[1] as string));
    const dangling = [...used].filter((x) => !defined.has(x));
    check("every pointer in it resolves",
      used.size > 0 && dangling.length === 0,
      used.size === 0 ? "the file contains no pointers at all, so this proves nothing"
        : dangling.length ? `${dangling.length} dangling: ${dangling.slice(0, 4).join(" ")}`
        : `${used.size} distinct pointers, all defined among ${defined.size} records`);
  }

  /*
   * The privacy direction. The endpoint reads through Directus with the
   * caller's own accountability, so this is really asking whether that
   * wiring is still in place — a future refactor to a direct database
   * query would pass every structural check above and quietly publish
   * every living person in the tree.
   */
  const living = rows(await get(admin,
    `/items/persons?limit=1&fields=display_name&filter[is_living][_eq]=true&filter[tree][slug][_eq]=${slug}`))[0];
  const name = String(living?.["display_name"] ?? "").split(" ")[0] ?? "";
  if (!name) {
    unrunnable("and an anonymous export omits the living", `no living person in the public tree "${slug}"`);
    return;
  }

  const anon = await fetchGed(null);
  // Gated on the positive: an anonymous export that returns nothing at
  // all would "omit the living" trivially.
  const reachable = anon.status === 200 && anon.body.includes("0 TRLR") && anon.body.includes("INDI");
  if (!reachable) {
    unrunnable("and an anonymous export omits the living",
      `an anonymous caller got ${anon.status} and no INDI records, so omitting one proves nothing`);
    return;
  }
  check("and an anonymous export omits the living",
    !anon.body.includes(name) && full.body.includes(name),
    `"${name}" is in the member's export and ${anon.body.includes(name) ? "ALSO in" : "absent from"} the anonymous one ` +
    `(${(anon.body.match(/\r\n0 @I/g) ?? []).length} of ${(full.body.match(/\r\n0 @I/g) ?? []).length} people)`);
}

async function readmeClaims(): Promise<void> {
  section("the README's own numbers");
  let readme: string;
  try {
    readme = readFileSync(fromRoot("README.md"), "utf8");
  } catch {
    unrunnable("the README's claims", "README.md is not where it should be");
    return;
  }
  // Counted before this section adds anything, so the arithmetic does
  // not depend on where in the section the assertion happens to sit.
  const before = results.filter((r) => !r.name.startsWith("── ")).length;
  const CLAIMS_HERE = 4;

  const claim = (re: RegExp): number | null => {
    const m = re.exec(readme);
    return m?.[1] ? Number(m[1]) : null;
  };

  // Collections that have a table. The six nav folders are rows in
  // `directus_collections` with `schema: null` and no fields — they are
  // sidebar furniture, not part of the data model, and counting them
  // would quietly turn the README's "20 collections" into 26 without
  // anything being added to the schema.
  const token = await login("owner@stemma.example.com");
  const collections = token
    ? rows(await get(token, "/collections?limit=-1&fields=collection,schema"))
        .filter((c) => !String(c["collection"]).startsWith("directus_") && c["schema"] !== null).length
    : 0;
  const saysCollections = claim(/\*\*(\d+)\s+collections\*\*/);
  check("it states the number of collections",
    saysCollections !== null && saysCollections === collections,
    `README says ${saysCollections ?? "nothing"}, there are ${collections}`);

  // Self-referential on purpose: the figure has to match the suite that
  // is printing it, so adding a check without touching the README fails.
  const saysChecks = claim(/(\d+)-check\s+suite/);
  const willBe = before + CLAIMS_HERE;
  check("and the size of this suite",
    saysChecks === willBe,
    `README says ${saysChecks ?? "nothing"}, this run has ${willBe}`);

  const client = new Client({ host: DB_HOST, port: DB_PORT, database: DB_DATABASE, user: DB_USER, password: DB_PASSWORD });
  try {
    await client.connect();
    const one = async (sql: string): Promise<number> => Number((await client.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
    const triggers = await one("SELECT count(*) AS n FROM pg_trigger WHERE tgname LIKE 'stemma%' AND NOT tgisinternal");
    const constraints = await one(
      "SELECT count(*) AS n FROM pg_constraint WHERE contype IN ('c','u') AND connamespace='public'::regnamespace" +
      " AND conname NOT LIKE '%_pkey' AND conrelid::regclass::text NOT LIKE 'directus_%'");
    const saysTriggers = claim(/(\d+)\s+triggers/);
    const saysConstraints = claim(/(\d+)\s+constraints/);
    check("and the number of database rules it rests on",
      saysTriggers === triggers && saysConstraints === constraints,
      `README says ${saysConstraints ?? "?"} constraints / ${saysTriggers ?? "?"} triggers; ` +
      `there are ${constraints} / ${triggers}`);
  } catch (e) {
    unrunnable("and the number of database rules it rests on", e instanceof Error ? e.message : String(e));
  } finally {
    await client.end().catch(() => {});
  }

  // Both directions: a layout or theme shipped without a mention, or
  // mentioned without being shipped, is the same kind of drift.
  const modes = (readFileSync(fromRoot("apps/web/app/routes/tree.tsx"), "utf8")
    .match(/\{ id: "[a-z]+", label:/g) ?? []).length;
  const themes = (readFileSync(fromRoot("apps/web/app/components/Theme.tsx"), "utf8")
    .match(/\{ id: "[a-z]+", label:/g) ?? []).length;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const saysThemes = words[/(\w+)\s+themes/.exec(readme)?.[1]?.toLowerCase() ?? ""] ?? null;
  const saysModes = words[/(\w+)\s+layouts/.exec(readme)?.[1]?.toLowerCase() ?? ""] ?? null;
  check("and how many themes and layouts it offers",
    saysThemes === themes && saysModes === modes,
    `README says ${saysThemes ?? "?"} themes / ${saysModes ?? "?"} layouts; the app has ${themes} / ${modes}`);
}

/* ── report ────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log(`\n  Checks against ${URL_BASE}\n`);
  await databaseRules();
  await publicBoundary();
  await membership();
  await adminSurface();
  await dateParser();
  await gedcomExport();
  await readmeClaims();

  const real = results.filter((r) => !r.name.startsWith("── "));
  const pad = Math.max(...real.map((r) => r.name.length));
  let failed = 0, blocked = 0;
  for (const r of results) {
    if (r.name.startsWith("── ")) { console.log(`\n  \x1b[2m${r.name}\x1b[0m`); continue; }
    if (r.state === "fail") failed++;
    if (r.state === "unrunnable") blocked++;
    const mark = r.state === "pass" ? "\x1b[32mPASS\x1b[0m" : r.state === "fail" ? "\x1b[31mFAIL\x1b[0m" : "\x1b[33m????\x1b[0m";
    console.log(`  ${mark}  ${r.name.padEnd(pad)}  ${r.detail ? `\x1b[2m${r.detail}\x1b[0m` : ""}`);
  }
  const passed = real.length - failed - blocked;
  console.log();
  if (failed === 0 && blocked === 0) {
    console.log(`  \x1b[32m${passed}/${real.length} checks passed\x1b[0m\n`);
    return;
  }
  if (failed) console.log(`  \x1b[31m${failed} FAILED\x1b[0m`);
  if (blocked) console.log(`  \x1b[33m${blocked} could not run\x1b[0m \x1b[2m— counted as failures: a check that did not run has told you nothing\x1b[0m`);
  console.log(`  \x1b[2m${passed} passed\x1b[0m\n`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("  verification aborted:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
