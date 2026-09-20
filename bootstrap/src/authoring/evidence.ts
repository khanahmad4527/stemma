import {
  type Collection, pk, timestamps, m2o, o2m, dropdown, divider, str, text, date, url, cached, collectionRef, treeRef,
  confidence, CASCADE, SET_NULL,
} from "./_helpers.js";
import { inDomain } from "./_theme.js";

export const REPOSITORY_TYPES = ["archive", "library", "church", "government", "cemetery", "museum", "website", "private", "other"] as const;
export const SOURCE_TYPES = ["original", "derivative", "authored"] as const;
export const INFORMATION = ["primary", "secondary", "undetermined"] as const;
export const EVIDENCE = ["direct", "indirect", "negative"] as const;

/** What a citation may point at. The tree-agreement trigger knows the same list. */
export const CITABLE = ["persons", "person_names", "parentage", "couples", "events", "associations", "places"] as const;

export const repositories: Collection = {
  collection: "repositories",
  meta: inDomain("evidence", {
    icon: "account_balance",
    note: "$t:stemma_note_repositories",
    sort: 40,
    display_template: "{{name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    str("name", { required: true }),
    dropdown("type", REPOSITORY_TYPES, "other", { required: true }),
    text("address"),
    url("url", { width: "full" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    o2m("sources", "{{title}}"),
    ...timestamps(),
  ],
  relations: [
    { collection: "repositories", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
  ],
};

/**
 * A record set: the 1881 census, a parish register, a gravestone, a
 * family bible, a book. Not the specific page — that is the citation.
 *
 * `type` is Evidence Explained's first question of any source: is this
 * the original record, a derivative of it (an index, a transcription), or
 * an authored work that interpreted records?
 */
export const sources: Collection = {
  collection: "sources",
  meta: inDomain("evidence", {
    icon: "menu_book",
    note: "$t:stemma_note_sources",
    sort: 41,
    display_template: "{{title}}",
  }),
  fields: [
    pk(),
    treeRef(),
    str("title", { required: true, width: "full" }),
    str("author"),
    str("publication", { note: "$t:stemma_note_publication" }),
    dropdown("type", SOURCE_TYPES, "original", { required: true, note: "$t:stemma_note_source_type" }),
    m2o("repository", "{{name}}", { note: "$t:stemma_note_source_repository" }),
    url("url", { width: "full" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    o2m("citations", "{{locator}}"),
    ...timestamps(),
  ],
  relations: [
    { collection: "sources", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "sources", field: "repository", related_collection: "repositories", meta: { one_field: "sources" }, schema: SET_NULL },
  ],
};

/**
 * The specific place in a source and what it says.
 *
 * Three enums carry the Genealogical Proof Standard's triad: what kind of
 * source, what kind of information (primary — the informant was there;
 * secondary — they heard it), what kind of evidence (direct — answers the
 * question; indirect — needs other facts to; negative — the record was
 * searched and the person was not there). Negative evidence is the
 * research log's most valuable entry and the one every tool loses.
 */
export const citations: Collection = {
  collection: "citations",
  meta: inDomain("evidence", {
    icon: "format_quote",
    note: "$t:stemma_note_citations",
    sort: 42,
    display_template: "{{source.title}} — {{locator}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("source", "{{title}}", { required: true }),
    str("locator", { note: "$t:stemma_note_locator", placeholder: "p. 42, entry 17 · folio 12v · image 231" }),
    url("url", { width: "full", note: "$t:stemma_note_citation_url" }),
    date("date_accessed", { note: "$t:stemma_note_date_accessed" }),

    divider("Weight", "divider_weight", "balance"),
    dropdown("information", INFORMATION, "undetermined", { required: true, note: "$t:stemma_note_information" }),
    dropdown("evidence", EVIDENCE, "direct", { required: true, note: "$t:stemma_note_evidence" }),
    confidence("$t:stemma_note_citation_confidence"),

    divider("Text", "divider_text", "notes"),
    text("transcription", { note: "$t:stemma_note_transcription" }),
    text("citation_text", { note: "$t:stemma_note_citation_text" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),

    divider("Cites", "divider_cites", "link"),
    // Many-to-any: a citation supports a name, an edge, an event, a
    // couple, a place. One junction rather than seven.
    { field: "links", type: "alias",
      meta: { interface: "list-m2a", special: ["m2a"], note: "$t:stemma_note_citation_links" }, schema: null },
    ...timestamps(),
  ],
  relations: [
    { collection: "citations", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "citations", field: "source", related_collection: "sources", meta: { one_field: "citations" }, schema: CASCADE },
  ],
};

/**
 * The M2A junction. Carries `tree` so the tree-agreement trigger and the
 * public filter cover it, and `is_public_ok`, which a trigger sets from
 * the target row's own visibility — because "is the thing this cites
 * public" is not a flat comparison across seven collections.
 */
export const citationLinks: Collection = {
  collection: "citation_links",
  meta: inDomain("evidence", {
    icon: "link",
    note: "$t:stemma_note_citation_links_collection",
    sort: 43,
    hidden: true,
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("citation", "{{source.title}} — {{locator}}", { required: true }),
    collectionRef("collection"),
    { field: "item", type: "string", meta: { interface: "input", hidden: true }, schema: { is_nullable: false } },
    cached("is_public_ok", "$t:stemma_note_is_public_ok", { type: "boolean", hidden: true }),
    ...timestamps(),
  ],
  relations: [
    { collection: "citation_links", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "citation_links", field: "citation", related_collection: "citations",
      meta: { one_field: "links", junction_field: "item" }, schema: CASCADE },
    { collection: "citation_links", field: "item", related_collection: null,
      meta: { one_allowed_collections: [...CITABLE], one_collection_field: "collection", junction_field: "citation" },
      schema: null },
  ],
};
