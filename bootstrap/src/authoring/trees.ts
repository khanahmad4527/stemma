import {
  type Collection, pk, timestamps, m2o, o2m, dropdown, divider, str, text, int, bool, cached, treeRef,
  CASCADE, SET_NULL, CALENDARS,
} from "./_helpers.js";
import { inDomain } from "./_theme.js";

export const TREE_ROLES = ["owner", "editor", "contributor", "viewer"] as const;
const ROLE_COLORS = { owner: "#6644FF", editor: "#2ECDA7", contributor: "#3399FF", viewer: "#A2B5CD" };

export const trees: Collection = {
  collection: "trees",
  meta: inDomain("tenancy", {
    icon: "account_tree",
    note: "$t:stemma_note_trees",
    sort: 1,
    display_template: "{{name}}",
  }),
  fields: [
    pk(),
    str("name", { required: true, note: "$t:stemma_note_tree_name" }),
    {
      ...str("slug", { required: true, unique: true, note: "$t:stemma_note_tree_slug" }),
      meta: {
        interface: "input", width: "half", required: true, note: "$t:stemma_note_tree_slug",
        validation: { slug: { _regex: "^[a-z0-9]+(-[a-z0-9]+)*$" } },
        validation_message: "$t:stemma_vm_slug",
      },
    },
    text("description", { note: "$t:stemma_note_tree_description" }),
    m2o("owner", "{{first_name}} {{last_name}}", { note: "$t:stemma_note_tree_owner" }),
    m2o("home_person", "{{display_name}}", { note: "$t:stemma_note_tree_home_person" }),

    divider("Visibility", "divider_visibility", "public"),
    // The public half of the security model. Default false and not-null:
    // a tree whose publicness is unknown must read as private.
    bool("is_public", false, { note: "$t:stemma_note_tree_is_public", label: "Public" }),
    // Public is not the same as findable. An unlisted tree answers at its
    // URL and appears in no index.
    bool("is_listed", true, { note: "$t:stemma_note_tree_is_listed", label: "Listed" }),
    // A timestamp the database sets once. Not `cached()` — that helper
    // makes a string, and this was one for an hour.
    { field: "first_published_at", type: "timestamp",
      meta: { interface: "datetime", readonly: true, hidden: true, width: "half", note: "$t:stemma_note_tree_first_published_at" },
      schema: {} },
    str("legacy_contact", { note: "$t:stemma_note_tree_legacy_contact" }),

    divider("Conventions", "divider_conventions", "tune"),
    // The privacy rules a tree runs on. Read by triggers and flows, never
    // by the access filter, which only ever sees the booleans they set.
    int("living_cutoff_years", { def: 100, note: "$t:stemma_note_living_cutoff_years" }),
    int("privacy_years_after_death", { def: 0, note: "$t:stemma_note_privacy_years_after_death" }),
    dropdown("default_name_order", ["given_first", "surname_first"], "given_first", { note: "$t:stemma_note_default_name_order" }),
    // Whether "van Gogh" sorts under G (Netherlands) or V (Belgium, the
    // Anglosphere). A property of the tree's tradition, not of the name.
    dropdown("particle_sorting", ["ignore", "include"], "ignore", { note: "$t:stemma_note_particle_sorting" }),
    dropdown("default_calendar", CALENDARS, "gregorian", { note: "$t:stemma_note_default_calendar" }),

    divider("Contents", "divider_contents", "account_tree"),
    o2m("members", "{{user.first_name}} {{user.last_name}} — {{role}}"),
    o2m("persons", "{{display_name}}"),
    o2m("invitations", "{{email}} → {{role}}"),
    ...timestamps(),
  ],
  relations: [
    // SET NULL, not CASCADE: deleting a user account must not delete the
    // family history they happened to have created. A trigger promotes
    // another owner when this is nulled (constraints.ts).
    { collection: "trees", field: "owner", related_collection: "directus_users", meta: {}, schema: SET_NULL },
    { collection: "trees", field: "home_person", related_collection: "persons", meta: {}, schema: SET_NULL },
  ],
};

export const treeMembers: Collection = {
  collection: "tree_members",
  meta: inDomain("tenancy", {
    icon: "group",
    note: "$t:stemma_note_tree_members",
    sort: 2,
    display_template: "{{user.first_name}} {{user.last_name}} — {{role}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("user", "{{first_name}} {{last_name}}", { required: true }),
    dropdown("role", TREE_ROLES, "viewer", { note: "$t:stemma_note_member_role", required: true, colors: ROLE_COLORS }),
    ...timestamps(),
  ],
  relations: [
    { collection: "tree_members", field: "tree", related_collection: "trees", meta: { one_field: "members" }, schema: CASCADE },
    { collection: "tree_members", field: "user", related_collection: "directus_users", meta: {}, schema: CASCADE },
  ],
};

/**
 * A membership that has not happened yet.
 *
 * Somebody is invited by email before they have an account. The flow that
 * turns an accepted invitation into a `tree_members` row is a later step;
 * the table is here now because it is part of the shape and adding it
 * later means adding it to the tree-agreement trigger and the policies
 * later too.
 */
export const treeInvitations: Collection = {
  collection: "tree_invitations",
  meta: inDomain("tenancy", {
    icon: "mail",
    note: "$t:stemma_note_tree_invitations",
    sort: 3,
    display_template: "{{email}} → {{role}}",
    hidden: true,
  }),
  fields: [
    pk(),
    treeRef(),
    str("email", { required: true }),
    dropdown("role", TREE_ROLES, "viewer", { required: true, colors: ROLE_COLORS }),
    dropdown("status", ["pending", "accepted", "expired", "revoked"], "pending", { required: true,
      colors: { pending: "#FFA439", accepted: "#2ECDA7", expired: "#A2B5CD", revoked: "#E35169" } }),
    cached("token", "$t:stemma_note_invitation_token", { hidden: true }),
    m2o("invited_by", "{{first_name}} {{last_name}}"),
    { field: "expires_at", type: "timestamp", meta: { interface: "datetime", width: "half" }, schema: {} },
    { field: "accepted_at", type: "timestamp", meta: { interface: "datetime", width: "half", readonly: true }, schema: {} },
    ...timestamps(),
  ],
  relations: [
    { collection: "tree_invitations", field: "tree", related_collection: "trees", meta: { one_field: "invitations" }, schema: CASCADE },
    { collection: "tree_invitations", field: "invited_by", related_collection: "directus_users", meta: {}, schema: SET_NULL },
  ],
};
