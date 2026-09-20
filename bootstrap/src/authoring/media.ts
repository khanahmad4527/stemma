import {
  type Collection, type Field, pk, timestamps, m2o, o2m, dropdown, divider, str, text, float, bool, cached,
  treeRef, collectionRef, dated, restricted, CASCADE, SET_NULL,
} from "./_helpers.js";
import { inDomain } from "./_theme.js";

export const MEDIA_KINDS = ["photo", "document", "audio", "video", "gedcom", "other"] as const;
export const LICENCES = ["all_rights_reserved", "cc_by", "cc_by_sa", "cc_by_nc", "cc0", "public_domain", "unknown"] as const;

/** What a media item may be attached to. */
export const ILLUSTRATABLE = ["persons", "events", "couples", "places", "citations", "sources"] as const;

/**
 * A file, as this tree knows it.
 *
 * The bytes live in directus_files; this row is what the tree says about
 * them — a caption, a date (photographs are undated too), who holds the
 * copyright and under what licence. `publishable` is the one the public
 * policy will read: a photograph of a dead ancestor under all-rights-
 * reserved is still not ours to publish.
 *
 * No `persons.portrait` yet. Enamel learned that hiding a file's row does
 * not hide its bytes at /assets/<uuid>; the avatar field waits for the
 * directus_files policy (build step 4).
 */
export const media: Collection = {
  collection: "media",
  meta: inDomain("media", {
    icon: "photo_library",
    note: "$t:stemma_note_media",
    sort: 50,
    display_template: "{{caption}}",
  }),
  fields: [
    pk(),
    treeRef(),
    { field: "file", type: "uuid",
      meta: { interface: "file", special: ["file"], display: "file", width: "half", required: true }, schema: { is_nullable: false } },
    dropdown("kind", MEDIA_KINDS, "photo", { required: true }),
    str("caption", { width: "full" }),

    divider("When", "divider_when", "event"),
    ...dated(),

    divider("Rights", "divider_rights", "copyright"),
    str("copyright_holder"),
    dropdown("licence", LICENCES, "unknown", { required: true, note: "$t:stemma_note_licence" }),
    bool("publishable", false, { note: "$t:stemma_note_publishable", label: "Publishable" }),
    restricted(),

    divider("Text", "divider_text", "notes"),
    text("transcript", { note: "$t:stemma_note_transcript" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),

    divider("Who is in it", "divider_subjects", "face"),
    o2m("subjects", "{{person.display_name}}"),
    divider("Attached to", "divider_attached", "link"),
    { field: "links", type: "alias",
      meta: { interface: "list-m2a", special: ["m2a"], note: "$t:stemma_note_media_links" }, schema: null },
    ...timestamps(),
  ],
  relations: [
    { collection: "media", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "media", field: "file", related_collection: "directus_files", meta: {}, schema: CASCADE },
  ],
};

/**
 * The people in a photograph, and where in it.
 *
 * One 1920 wedding photograph, eleven faces. The region is how a face
 * becomes a link. A subject row naming a living person makes the media
 * row unpublishable — that is the trigger's job, not the policy's.
 */
export const mediaSubjects: Collection = {
  collection: "media_subjects",
  meta: inDomain("media", {
    icon: "face",
    note: "$t:stemma_note_media_subjects",
    sort: 51,
    display_template: "{{person.display_name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("media", "{{caption}}", { required: true }),
    m2o("person", "{{display_name}}", { required: true }),
    // Fractions of width and height, so the region survives a resize.
    float("x", { note: "$t:stemma_note_region" }),
    float("y"),
    float("w"),
    float("h"),
    ...timestamps(),
  ],
  relations: [
    { collection: "media_subjects", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "media_subjects", field: "media", related_collection: "media", meta: { one_field: "subjects" }, schema: CASCADE },
    { collection: "media_subjects", field: "person", related_collection: "persons", meta: {}, schema: CASCADE },
  ],
};

export const mediaLinks: Collection = {
  collection: "media_links",
  meta: inDomain("media", {
    icon: "attachment",
    note: "$t:stemma_note_media_links_collection",
    sort: 52,
    hidden: true,
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("media", "{{caption}}", { required: true }),
    collectionRef("collection"),
    { field: "item", type: "string", meta: { interface: "input", hidden: true }, schema: { is_nullable: false } },
    ...timestamps(),
  ],
  relations: [
    { collection: "media_links", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "media_links", field: "media", related_collection: "media",
      meta: { one_field: "links", junction_field: "item" }, schema: CASCADE },
    { collection: "media_links", field: "item", related_collection: null,
      meta: { one_allowed_collections: [...ILLUSTRATABLE], one_collection_field: "collection", junction_field: "media" },
      schema: null },
  ],
};

/**
 * The tenancy column on the one system collection that needs it.
 *
 * `/assets/<uuid>` answers on directus_files' own permissions, so the
 * tree boundary has to be on the file itself — reading a media row gets
 * you a caption; reading the file gets you the photograph. A trigger
 * copies `tree` from the media row that references the file.
 */
export const fileFields: Field[] = [
  m2o("tree", "{{name}}", { note: "$t:stemma_note_file_tree" }),
  cached("is_public_ok", "$t:stemma_note_file_is_public_ok", { type: "boolean" }),
];

export const fileRelations = [
  { collection: "directus_files", field: "tree", related_collection: "trees", meta: {}, schema: SET_NULL },
];
