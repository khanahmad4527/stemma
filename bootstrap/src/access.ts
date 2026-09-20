/**
 * Who may read what.
 *
 * ── Two access paths, deliberately separate ────────────────────────────
 *
 * An anonymous visitor has no membership. Routing them through one makes
 * the public boundary depend on the membership machinery being correct,
 * and it should depend on as little as possible: it protects living
 * people from strangers rather than users from each other.
 *
 *   Public        flat booleans. tree.is_public, and per row the one or
 *                 two flags a trigger maintains for exactly this purpose.
 *   Contributors  relational. tree.members.user = $CURRENT_USER.
 *
 * ── A row about a living person is any row that names them ────────────
 *
 * Not just `persons`. The edge to their dead mother names her maiden name
 * — one of the three answers a bank asks for. The census they appear in
 * as a child. The photograph. The witness line. Every collection below
 * that can reach a living person has a filter that says so, and where the
 * honest answer is a join (a census with eleven people, a place known
 * only from someone's residence) the join runs on write into a boolean
 * and the filter compares the boolean. See constraints.ts VISIBILITY.
 *
 * ── One Directus role, capability from the membership ──────────────────
 *
 * A Directus role is global; a person's standing in a tree is not. So
 * everybody who signs in holds one role — Member — and what they may do
 * in a given tree is read off `tree_members.role` inside the filter.
 *
 * ── Requires a licence ─────────────────────────────────────────────────
 *
 * Directus 12 at core tier answers any permission carrying a filter with
 * `custom_permission_rules_enabled is a restricted resource`. Every rule
 * here carries one; a rule without one grants everything.
 */
import { api, login, must } from "./client.js";
import { log } from "./log.js";
import { COLLECTIONS } from "./authoring/index.js";
import { BRAND_FOLDER } from "./authoring/_theme.js";

type Action = "create" | "read" | "update" | "delete";
type Filter = Record<string, unknown>;

type Permission = {
  collection: string;
  action: Action;
  permissions?: Filter | null;
  validation?: Filter | null;
  fields?: string[];
  presets?: Filter | null;
};

type Policy = {
  name: string;
  icon: string;
  description: string;
  app_access: boolean;
  permissions: Permission[];
};

const ALL = ["*"];

/* ── the public filters ────────────────────────────────────────────────── */

const treePublic: Filter = { tree: { is_public: { _eq: true } } };
const notHidden = { is_living: { _eq: false }, is_restricted: { _eq: false } };
const notRestricted: Filter = { is_restricted: { _eq: false } };

/** What an anonymous visitor may know about a person. `notes` is never here. */
const PUBLIC_PERSON_FIELDS = [
  "id", "tree", "display_name", "sort_name", "public_id", "sex_recorded", "is_living", "biography", "multiple_birth",
  "names", "parents", "children", "events", "participations",
];

/**
 * Everything on a row except its private notes.
 *
 * Presentation-only fields are dropped by what they *are* rather than by
 * what they are called: a divider and the collapsed system group are both
 * `alias` + `no-data`, hold no column, and granting them reads nothing.
 * The old test was `startsWith("divider_")`, which was a naming
 * convention doing a type's job and silently stopped covering the day a
 * second kind of presentation field appeared.
 */
const isPresentation = (f: { meta?: Record<string, unknown> }): boolean => {
  const special = (f.meta?.["special"] ?? []) as string[];
  return Array.isArray(special) && special.includes("no-data");
};

const allBut = (collection: string, ...hidden: string[]): string[] =>
  (COLLECTIONS.find((c) => c.collection === collection)?.fields ?? [])
    .filter((f) => !isPresentation(f))
    .map((f) => f.field)
    .filter((f) => !hidden.includes(f));

const PUBLIC: Policy = {
  name: "Public genealogy",
  icon: "public",
  description: "Anonymous read of public trees, with living and restricted people — and every row that names them — suppressed. No membership involved.",
  app_access: false,
  permissions: [
    { collection: "trees", action: "read", permissions: { is_public: { _eq: true } },
      fields: ["id", "name", "slug", "description", "is_public", "is_listed", "home_person", "default_name_order", "particle_sorting", "persons"] },
    { collection: "persons", action: "read", permissions: { _and: [treePublic, notHidden] }, fields: PUBLIC_PERSON_FIELDS },
    { collection: "person_names", action: "read",
      permissions: { _and: [treePublic, { person: notHidden }] }, fields: allBut("person_names") },
    { collection: "parentage", action: "read",
      permissions: { _and: [treePublic, notRestricted, { parent: notHidden }, { child: notHidden }, { status: { _neq: "disproven" } }] },
      fields: allBut("parentage", "notes") },
    { collection: "couples", action: "read",
      permissions: { _and: [treePublic, notRestricted, { person_a: notHidden }, { person_b: notHidden }] },
      fields: allBut("couples", "notes") },
    { collection: "associations", action: "read",
      permissions: { _and: [treePublic, notRestricted, { person_a: notHidden }, { person_b: notHidden }] },
      fields: allBut("associations", "notes") },
    { collection: "event_types", action: "read",
      permissions: { _or: [{ tree: { _null: true } }, treePublic] }, fields: ALL },
    {
      // Filed under a dead person or a couple of two dead people, not
      // restricted, and naming nobody living — the trigger-maintained
      // boolean stands in for "check every participant".
      collection: "events", action: "read",
      permissions: { _and: [
        treePublic, notRestricted, { has_living_participant: { _eq: false } },
        { _or: [
          { subject_person: notHidden },
          { subject_couple: { person_a: notHidden, person_b: notHidden } },
        ] },
      ] },
      fields: allBut("events", "notes"),
    },
    { collection: "event_participants", action: "read",
      permissions: { _and: [treePublic, { person: notHidden }, { event: { is_restricted: { _eq: false }, has_living_participant: { _eq: false } } }] },
      fields: allBut("event_participants", "notes") },
    {
      // A street known only from a living person's residence stays
      // private; so does every address-level place.
      collection: "places", action: "read",
      permissions: { _and: [treePublic, { has_public_reference: { _eq: true } }, { type: { _neq: "address" } }] },
      fields: allBut("places", "notes"),
    },
    { collection: "place_names", action: "read",
      permissions: { _and: [treePublic, { place: { has_public_reference: { _eq: true }, type: { _neq: "address" } } }] },
      fields: allBut("place_names", "notes") },
    { collection: "repositories", action: "read", permissions: treePublic, fields: allBut("repositories", "notes") },
    { collection: "sources", action: "read", permissions: treePublic, fields: allBut("sources", "notes") },
    {
      // A citation is public when something it supports is.
      collection: "citations", action: "read",
      permissions: { _and: [treePublic, { links: { is_public_ok: { _eq: true } } }] },
      fields: allBut("citations", "notes"),
    },
    { collection: "citation_links", action: "read",
      permissions: { _and: [treePublic, { is_public_ok: { _eq: true } }] }, fields: ALL },
    { collection: "media", action: "read",
      permissions: { _and: [treePublic, { publishable: { _eq: true } }, notRestricted, { file: { is_public_ok: { _eq: true } } }] },
      fields: allBut("media", "notes") },
    { collection: "media_subjects", action: "read",
      permissions: { _and: [treePublic, { person: notHidden }, { media: { publishable: { _eq: true } } }] }, fields: ALL },
    { collection: "media_links", action: "read",
      permissions: { _and: [treePublic, { media: { publishable: { _eq: true }, file: { is_public_ok: { _eq: true } } } }] }, fields: ALL },
    {
      // The bytes. /assets answers on this collection alone, so this is
      // the rule that actually decides whether a photograph leaves the
      // building. `is_public_ok` is set by the media trigger.
      collection: "directus_files", action: "read",
      // Two arms, and they are different kinds of thing. The first is the
      // photograph rule: a file leaves the building only when its tree is
      // public and a media row has set `is_public_ok`. The second is the
      // logo, which has no tree and no media row and still has to load on
      // an anonymous login screen — so branding is identified by the
      // folder it lives in rather than by borrowing a flag that means
      // "nobody in this picture is living".
      permissions: { _or: [
        { _and: [treePublic, { is_public_ok: { _eq: true } }] },
        { folder: { name: { _eq: BRAND_FOLDER } } },
      ] },
      fields: ["id", "title", "type", "width", "height", "filesize", "tree", "is_public_ok"],
    },
  ],
};

/* ── membership ─────────────────────────────────────────────────────────── */

const isMember: Filter = { tree: { members: { user: { _eq: "$CURRENT_USER" } } } };

/** Members at one of these standings in *this* tree. */
const memberAt = (...roles: string[]): Filter => ({
  tree: { members: { _and: [{ user: { _eq: "$CURRENT_USER" } }, { role: { _in: roles } }] } },
});

const WRITERS = ["owner", "editor"];

/** On the trees row itself the membership is one hop nearer. */
const treeMemberAt = (...roles: string[]): Filter => ({
  members: { _and: [{ user: { _eq: "$CURRENT_USER" } }, { role: { _in: roles } }] },
});

/**
 * Read, add, change, remove — scoped to standing in the row's tree.
 *
 * `create` is the one Directus cannot express. It ignores `permissions`
 * for create — there is no row yet — and `validation` is a flat check on
 * the payload's own fields: a relational rule like `tree.members.user`
 * is answered with 400 for everyone, contributor and stranger alike. So
 * who may *add* to a tree is decided where every other rule is —
 * `stemma_writer_is_member` in constraints.ts reads `user_created`
 * against tree_members before the row lands. The policy grants create;
 * the database decides.
 */
const memberCrud = (collection: string): Permission[] => [
  { collection, action: "read", permissions: isMember, fields: ALL },
  { collection, action: "create", permissions: {}, fields: ALL },
  { collection, action: "update", permissions: memberAt(...WRITERS), fields: ALL },
  { collection, action: "delete", permissions: memberAt(...WRITERS), fields: ALL },
];

/** Every collection that carries `tree` and follows the plain rule. */
const TREE_DATA = COLLECTIONS.map((c) => c.collection)
  .filter((c) => !["trees", "tree_members", "tree_invitations", "event_types"].includes(c));

const MEMBER: Policy = {
  name: "Tree member",
  icon: "group",
  description: "Signed-in contributor. Sees and changes the trees they belong to, at the standing their membership records.",
  app_access: true,
  permissions: [
    // Trees: read as a member; make your own (the owner trigger adds the
    // membership); change as a writer; delete only as an owner — deleting
    // cascades to every person in it, which is a different kind of act.
    { collection: "trees", action: "read", permissions: { members: { user: { _eq: "$CURRENT_USER" } } }, fields: ALL },
    { collection: "trees", action: "create", permissions: {}, fields: ALL, presets: { owner: "$CURRENT_USER" } },
    { collection: "trees", action: "update", permissions: treeMemberAt(...WRITERS), fields: ALL },
    { collection: "trees", action: "delete", permissions: treeMemberAt("owner"), fields: ALL },

    // Membership and invitations: visible to the tree, administered by owners.
    { collection: "tree_members", action: "read", permissions: isMember, fields: ALL },
    { collection: "tree_members", action: "create", permissions: {}, fields: ALL },
    { collection: "tree_members", action: "update", permissions: memberAt("owner"), fields: ALL },
    { collection: "tree_members", action: "delete", permissions: memberAt("owner"), fields: ALL },
    { collection: "tree_invitations", action: "read", permissions: memberAt("owner"), fields: ALL },
    { collection: "tree_invitations", action: "create", permissions: {}, fields: ALL },
    { collection: "tree_invitations", action: "update", permissions: memberAt("owner"), fields: ALL },
    { collection: "tree_invitations", action: "delete", permissions: memberAt("owner"), fields: ALL },

    // Event types: global rows are read by all and owned by admins; a
    // tree's own rows follow the writer rule.
    { collection: "event_types", action: "read", permissions: { _or: [{ tree: { _null: true } }, isMember] }, fields: ALL },
    // `_submitted`: a rule on an absent field does not fire, so `_nnull`
    // alone let a member create a global type by leaving `tree` out.
    { collection: "event_types", action: "create", permissions: {},
      validation: { _and: [{ tree: { _submitted: true } }, { tree: { _nnull: true } }] }, fields: ALL },
    { collection: "event_types", action: "update", permissions: { _and: [{ tree: { _nnull: true } }, memberAt(...WRITERS)] }, fields: ALL },
    { collection: "event_types", action: "delete", permissions: { _and: [{ tree: { _nnull: true } }, memberAt(...WRITERS)] }, fields: ALL },

    ...TREE_DATA.flatMap(memberCrud),

    // Files: a member reads their trees' files and their own uploads (a
    // file has no tree until a media row claims it); anyone signed in may
    // upload; writers change.
    { collection: "directus_files", action: "read",
      permissions: { _or: [isMember, { uploaded_by: { _eq: "$CURRENT_USER" } }] }, fields: ALL },
    { collection: "directus_files", action: "create", permissions: {}, fields: ALL },
    { collection: "directus_files", action: "update",
      permissions: { _or: [memberAt(...WRITERS), { uploaded_by: { _eq: "$CURRENT_USER" } }] },
      fields: ["title", "description", "tags", "folder"] },
    { collection: "directus_folders", action: "read", permissions: {}, fields: ALL },
  ],
};

export const POLICIES: Policy[] = [PUBLIC, MEMBER];

export const ROLES = [
  {
    name: "Member",
    icon: "person",
    description: "Everybody who signs in. What they may do in any given tree comes from their tree_members row, not from this role.",
    policies: ["Tree member"],
  },
];

/* ── applying it ─────────────────────────────────────────────────────────── */

type IdName = { id: string; name: string };

/** The policy attached to no role: what an unauthenticated request gets. */
async function publicPolicyId(): Promise<string> {
  const rows = await must<IdName[]>("find the public policy", api.get("/policies?limit=-1&fields=id,name"));
  const found = rows.find((p) => p.name === "$t:public_label" || p.name === "Public");
  if (!found) throw new Error("cannot find the built-in public policy");
  return found.id;
}

async function setPermissions(policyId: string, label: string, perms: Permission[]): Promise<void> {
  // Replaced wholesale. Appending is how an access model drifts open:
  // Directus ORs the rules, so a narrowed filter beside a stale copy of
  // the old one silently grants everything the old one did.
  const current = await must<Array<{ id: number }>>(
    "list permissions", api.get(`/permissions?limit=-1&fields=id&filter[policy][_eq]=${policyId}`));
  if (current.length) {
    await must(`clear permissions on ${label}`, api.delete("/permissions", current.map((p) => p.id)));
  }
  let made = 0;
  for (const perm of perms) {
    const r = await api.post("/permissions", {
      policy: policyId, collection: perm.collection, action: perm.action,
      permissions: perm.permissions ?? {}, validation: perm.validation ?? {},
      fields: perm.fields ?? ALL, presets: perm.presets ?? null,
    });
    if (r.ok) made++;
    else log.fail(`  ${label}: ${perm.action} ${perm.collection} — ${r.error.message}`);
  }
  log.info(`  ${made}/${perms.length} permissions on ${label}`);
}

export async function applyAccess(): Promise<void> {
  log.step("Access policies");
  const existing = await must<IdName[]>("list policies", api.get("/policies?limit=-1&fields=id,name"));
  const byName = new Map(existing.map((p) => [p.name, p.id]));

  for (const policy of POLICIES) {
    // The public rules hang off the built-in public policy — the one
    // Directus consults when there is no token. A second policy by that
    // name would look correct in the admin and never be consulted.
    if (policy === PUBLIC) {
      const id = await publicPolicyId();
      log.made("public policy (built-in) — anonymous reads");
      await setPermissions(id, policy.name, policy.permissions);
      continue;
    }
    let id = byName.get(policy.name);
    if (id) log.skip(`policy ${policy.name}`);
    else {
      const created = await must<IdName>(`create policy ${policy.name}`, api.post("/policies", {
        name: policy.name, icon: policy.icon, description: policy.description,
        app_access: policy.app_access, admin_access: false, enforce_tfa: false,
      }));
      id = created.id; byName.set(policy.name, id);
      log.made(`policy ${policy.name}`);
    }
    await setPermissions(id, policy.name, policy.permissions);
  }

  log.step("Roles");
  const roleRows = await must<IdName[]>("list roles", api.get("/roles?limit=-1&fields=id,name"));
  const roleByName = new Map(roleRows.map((r) => [r.name, r.id]));
  for (const role of ROLES) {
    let id = roleByName.get(role.name);
    if (id) log.skip(`role ${role.name}`);
    else {
      const created = await must<IdName>(`create role ${role.name}`,
        api.post("/roles", { name: role.name, icon: role.icon, description: role.description }));
      id = created.id;
      log.made(`role ${role.name}`);
    }
    for (const policyName of role.policies) {
      const policyId = byName.get(policyName);
      if (!policyId) { log.warn(`role ${role.name}: unknown policy "${policyName}"`); continue; }
      const linked = await must<Array<{ id: number }>>("check access",
        api.get(`/access?limit=1&fields=id&filter[role][_eq]=${id}&filter[policy][_eq]=${policyId}`));
      if (linked.length) continue;
      const r = await api.post("/access", { role: id, policy: policyId, sort: 1 });
      if (r.ok) log.made(`  ${role.name} ← ${policyName}`);
      else log.fail(`  ${role.name} ← ${policyName}: ${r.error.message}`);
    }
  }
}

async function main(): Promise<void> {
  log.step(`Connecting to ${api.url}`);
  await login();
  await applyAccess();
  const failed = log.failures();
  if (failed > 0) {
    log.warn(`${failed} rule${failed === 1 ? "" : "s"} failed`);
    log.info("`custom_permission_rules_enabled is a restricted resource` means the instance has no licence");
    log.info("key. Every rule here carries a filter, so at core tier none can exist — put an Open Innovation");
    log.info("Grant key in DIRECTUS_LICENSE_KEY and recreate the container.");
    process.exitCode = 1;
    return;
  }
  log.done("Access model applied — now `pnpm verify`");
}

main().catch((err) => {
  log.fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
