/**
 * The authoring pass.
 *
 * ── What this file is, and what it is not ──────────────────────────────
 *
 * Stemma's schema is not maintained as code. Directus 12.3 ships
 * Environment Sync: `d6s sync pull` writes an instance's collections,
 * fields, relations, policies, roles, flows and translations to JSON
 * under `directus/`, and `d6s sync push` applies them elsewhere. Those
 * files are what other environments are built from. They are generated
 * and never hand-edited.
 *
 * Which leaves one gap: something has to put the schema into the first
 * instance before there is anything to pull. Directus's own answer is
 * "model it in the Data Studio and pull" — clicks. An agent cannot click,
 * so this is the clicks written down: it drives the live instance over
 * REST, and `d6s sync pull` captures the result. It runs again whenever
 * the model grows, the way a person would open the Data Studio again.
 *
 * After each pull, `directus/` and the instance agree, and `directus/` is
 * what gets pushed. Edit the model here *or* in the Data Studio — both
 * are ways of changing the instance — and then pull. Never edit the JSON.
 *
 * It is idempotent: an existing field has its meta (and its default)
 * reconciled rather than skipped, so a corrected note or a widened choice
 * list reaches an instance that already has the field.
 *
 * ── What is deliberately absent ────────────────────────────────────────
 *
 * Every rule that matters. No person may be their own ancestor; a couple
 * is unordered; a row's tree must agree with the rows it points at; a
 * death ends a life. None of those are expressible through `/fields`,
 * none are carried by `d6s sync`, and all live in `constraints.ts` as
 * Postgres DDL. The shape is here. The shape is not the guarantee.
 */
import { api, login, must } from "./client.js";
import { log } from "./log.js";
import { STRINGS } from "./strings.js";
import { COLLECTIONS, FOLDERS, SYSTEM_FIELDS, SYSTEM_RELATIONS } from "./authoring/index.js";
import type { Collection, Field, Relation } from "./authoring/_helpers.js";

async function exists(path: string): Promise<boolean> {
  return (await api.get(path)).ok;
}

/**
 * Meta keys the authoring layer owns, and what "not declared" means.
 *
 * A PATCH to `/fields` merges: keys you send are written, keys you leave
 * out keep whatever they were. That makes *adding* a property idempotent
 * and *removing* one silently impossible, which is not what a declarative
 * layer means. Taking `hidden: true` off `timestamps()` reached a fresh
 * instance and left every existing one with the audit columns still
 * hidden — inside the new group, so the group opened onto nothing.
 *
 * So the declaration is authoritative for these keys, and absent means
 * the value below rather than "unchanged". Structural keys are
 * deliberately not on the list: `special` says what a column *is*, and
 * `sort` is assigned by Directus on creation and would be lost.
 */
const OWNED_META: Record<string, unknown> = {
  hidden: false,
  readonly: false,
  required: false,
  group: null,
  note: null,
  display: null,
  display_options: null,
  options: null,
  conditions: null,
  validation: null,
  validation_message: null,
};

async function applyField(collection: string, field: Field): Promise<void> {
  const current = await api.get<{ type: string; schema?: { default_value?: unknown } | null }>(`/fields/${collection}/${field.field}`);
  if (current.ok) {
    // The default travels with the meta when it changed: `lineage` went
    // from biological to birth, and a PATCH that sent only meta would have
    // left every new row saying the old word.
    //
    // Only when it changed. Sending `schema` at all makes Directus re-issue
    // `ALTER COLUMN … TYPE`, and Postgres refuses that for any column a
    // trigger's `UPDATE OF` list or the data_issues view references — which
    // after the rules are in is a dozen of them. Idempotency means asking
    // first.
    const want = field.schema && "default_value" in field.schema ? field.schema.default_value : undefined;
    const have = current.data.schema?.default_value;
    const changed = want !== undefined && String(want) !== String(have ?? "");
    const r = await api.patch(`/fields/${collection}/${field.field}`, {
      meta: { ...OWNED_META, ...(field.meta ?? {}) },
      ...(changed ? { schema: { default_value: want } } : {}),
    });
    if (!r.ok) log.fail(`  ${collection}.${field.field} — ${r.error.message}`);
    else log.skip(`  ${collection}.${field.field}${changed ? ` (default → ${String(want)})` : ""}`);
    return;
  }
  const r = await api.post(`/fields/${collection}`, field);
  if (!r.ok) log.fail(`  ${collection}.${field.field} — ${r.error.message}`);
  else log.made(`  ${collection}.${field.field}`);
}

/**
 * Fields whose *type* changed.
 *
 * A PATCH reconciles meta and default; it cannot turn a varchar into a
 * timestamp. Deleting a field deletes its data, so this is an explicit
 * list rather than an automatic comparison — only ever add a pair here
 * when losing the column's contents is the intent.
 */
const RETYPED: Array<[string, string]> = [
  ["trees", "first_published_at"],   // was a string; is a timestamp
];

async function dropRetyped(): Promise<void> {
  for (const [collection, field] of RETYPED) {
    const current = await api.get<{ type: string }>(`/fields/${collection}/${field}`);
    if (!current.ok) continue;
    const wanted = COLLECTIONS.find((c) => c.collection === collection)?.fields.find((f) => f.field === field);
    if (!wanted || current.data.type === wanted.type) continue;
    const r = await api.delete(`/fields/${collection}/${field}`);
    if (r.ok) log.made(`dropped ${collection}.${field} (${current.data.type} → ${wanted.type})`);
    else log.fail(`drop ${collection}.${field} — ${r.error.message}`);
  }
}

async function applyCollection(c: Collection): Promise<void> {
  if (await exists(`/collections/${c.collection}`)) {
    await must(`update collection ${c.collection}`, api.patch(`/collections/${c.collection}`, { meta: c.meta }));
    log.skip(`collection ${c.collection}`);
  } else {
    await must(
      `create collection ${c.collection}`,
      api.post("/collections", {
        collection: c.collection,
        meta: c.meta,
        schema: {},
        fields: c.fields.filter((f) => f.field === "id"),
      }),
    );
    log.made(`collection ${c.collection}`);
  }
  // `id` included. It used to be skipped on the grounds that the
  // collection POST already made it, which was true and still left its
  // meta frozen at whatever the first run wrote — so moving it into the
  // system group would have reached a fresh instance and no existing one.
  // The PATCH is meta-only: `pk()` declares no default, so `applyField`
  // never sends `schema` for it and never re-issues ALTER COLUMN on a
  // primary key.
  for (const field of c.fields) await applyField(c.collection, field);
}

/**
 * The nav folders, which are collections with no table.
 *
 * Directus models a sidebar folder as a row in `directus_collections`
 * with nothing in `directus_fields` and no table behind it — `schema:
 * null` on the POST, not `{}`, which would create one. They have to
 * exist before the twenty real collections name them in `meta.group`,
 * although Directus does not enforce that: a dangling group silently
 * removes the collection from the sidebar rather than erroring, which is
 * a worse failure than a rejection and the reason these go first.
 */
async function applyFolders(): Promise<void> {
  for (const f of FOLDERS) {
    if (await exists(`/collections/${f.collection}`)) {
      await must(`update folder ${f.collection}`, api.patch(`/collections/${f.collection}`, { meta: f.meta }));
      log.skip(`folder ${f.collection}`);
      continue;
    }
    await must(
      `create folder ${f.collection}`,
      api.post("/collections", { collection: f.collection, meta: f.meta, schema: null, fields: [] }),
    );
    log.made(`folder ${f.collection}`);
  }
}

async function applyRelations(relations: Relation[]): Promise<void> {
  const existing = await must<Array<{ collection: string; field: string }>>("list relations", api.get("/relations"));
  const have = new Set(existing.map((r) => `${r.collection}.${r.field}`));

  for (const rel of relations) {
    const key = `${rel.collection}.${rel.field}`;
    if (have.has(key)) { log.skip(`relation ${key}`); continue; }
    const body: Record<string, unknown> = { collection: rel.collection, field: rel.field, related_collection: rel.related_collection, meta: rel.meta ?? {} };
    if (rel.schema !== null) body["schema"] = rel.schema ?? {};
    const r = await api.post("/relations", body);
    if (!r.ok) log.fail(`relation ${key} — ${r.error.message}`);
    else log.made(`relation ${key} → ${rel.related_collection ?? "(any)"}`);
  }
}

/**
 * Braces are not decoration in a translation value.
 *
 * Directus merges `directus_translations` into vue-i18n escaping only
 * `@ $ |`, so `{` and `}` stay live and the value is compiled as a
 * message with placeholders. One note here read "A list of {type,
 * value}", which is not a valid placeholder, so compiling it threw —
 * inside `loadLanguage`, whose `catch {}` discards the error. The
 * observable result was that **every** `$t:` key in the entire Data
 * Studio rendered raw, and `person_names`, the one collection carrying
 * that note, rendered an empty form: the SyntaxError surfaced again
 * during render and took the whole subtree with it.
 *
 * One brace pair, 287 labels, and a form that showed nothing. So this is
 * a refusal rather than a lint — the same pre-flight-and-refuse shape
 * `constraints.ts` uses, because the failure is silent and global and
 * the cost of catching it here is one regex. `verify.ts` asserts the
 * same rule against what is actually stored.
 */
const BRACED = /[{}]/;

/**
 * The `$t:` keys every note refers to. Reconciled rather than
 * create-only, so a corrected sentence reaches an instance that already
 * holds the key.
 */
async function applyStrings(): Promise<void> {
  const braced = Object.entries(STRINGS).filter(([, v]) => BRACED.test(v));
  if (braced.length > 0) {
    for (const [key, value] of braced) log.fail(`  ${key} contains a brace — vue-i18n will fail to compile it: ${value}`);
    throw new Error(
      `${braced.length} translation value(s) contain a brace. vue-i18n reads it as a placeholder, ` +
      "the compile throws inside Directus's own catch{}, and every $t: key in the Data Studio goes unresolved.",
    );
  }
  const existing = await must<Array<{ id: string; key: string; language: string; value: string }>>(
    "list translations",
    api.get("/translations?limit=-1&fields=id,key,language,value"),
  );
  const have = new Map(existing.map((t) => [`${t.key}::${t.language}`, t]));

  let made = 0, changed = 0;
  for (const [key, value] of Object.entries(STRINGS)) {
    const current = have.get(`${key}::en-US`);
    if (current) {
      if (current.value === value) continue;
      const r = await api.patch(`/translations/${current.id}`, { value });
      if (r.ok) changed++;
      else log.fail(`translation ${key}: ${r.error.message}`);
      continue;
    }
    const r = await api.post("/translations", { key, language: "en-US", value });
    if (r.ok) made++;
    else log.fail(`translation ${key}: ${r.error.message}`);
  }
  log.made(`${made} strings${changed ? `, ${changed} updated` : ""} (${Object.keys(STRINGS).length} total)`);
}

async function main(): Promise<void> {
  log.step(`Connecting to ${api.url}`);
  await login();
  log.info("authenticated as admin");

  log.step("Strings");
  await applyStrings();

  log.step("Nav folders");
  await applyFolders();

  log.step("Collections and fields");
  await dropRetyped();
  for (const c of COLLECTIONS) await applyCollection(c);

  log.step("Tenancy on directus_files");
  for (const [collection, fields] of Object.entries(SYSTEM_FIELDS)) {
    for (const f of fields) await applyField(collection, f);
  }

  log.step("Relations");
  await applyRelations([...COLLECTIONS.flatMap((c) => c.relations ?? []), ...SYSTEM_RELATIONS]);

  const failed = log.failures();
  if (failed > 0) {
    log.warn(`${failed} step${failed === 1 ? "" : "s"} failed — this instance is NOT fully built`);
    log.info("re-running is safe and picks up where this left off");
    process.exitCode = 1;
    return;
  }
  log.done(`${COLLECTIONS.length} collections in ${FOLDERS.length} folders — now \`pnpm rules\`, then \`pnpm pull\``);
}

main().catch((err) => {
  log.fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
