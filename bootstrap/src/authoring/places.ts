import {
  type Collection, pk, timestamps, m2o, o2m, dropdown, divider, str, text, float, cached, treeRef, date,
  CASCADE, SET_NULL,
} from "./_helpers.js";
import { inDomain } from "./_theme.js";

export const PLACE_TYPES = [
  "country", "state", "province", "region", "county", "district", "parish", "municipality",
  "city", "town", "village", "hamlet", "farm", "estate", "manor",
  "cemetery", "church", "hospital", "address", "ship", "at_sea", "unknown", "other",
] as const;

export const PRECISIONS = ["country", "region", "settlement", "address", "exact"] as const;

/**
 * A place, in the tree that records it.
 *
 * Per tree, not shared: "Grandma's house, 12 Oak Street" is private, and
 * sharing rows across tenants would leak it. Gdańsk is Gdańsk in every
 * tree anyway — the gazetteer ids are how two trees agree on that without
 * sharing a row. A read-only shared gazetteer tier is a later question.
 *
 * `parent_place` is the *current* hierarchy. Historical jurisdiction
 * (a village moved counties in 1974) is preserved where it matters — in
 * `events.place_original`, the string the record actually said.
 */
export const places: Collection = {
  collection: "places",
  meta: inDomain("places", {
    icon: "place",
    note: "$t:stemma_note_places",
    sort: 30,
    display_template: "{{name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    str("name", { required: true, note: "$t:stemma_note_place_name" }),
    dropdown("type", PLACE_TYPES, "unknown", { required: true, note: "$t:stemma_note_place_type" }),
    m2o("parent_place", "{{name}}", { note: "$t:stemma_note_parent_place" }),

    divider("Coordinates", "divider_coordinates", "my_location"),
    float("lat"),
    float("lng"),
    // A country centroid is not a street. A map needs to know which.
    dropdown("precision", PRECISIONS, null, { note: "$t:stemma_note_precision" }),

    divider("Gazetteers", "divider_gazetteers", "public"),
    str("geonames_id", { note: "$t:stemma_note_geonames_id" }),
    str("wikidata_id", { note: "$t:stemma_note_wikidata_id", placeholder: "Q1792" }),
    str("gov_id", { note: "$t:stemma_note_gov_id", placeholder: "DANZIGJO94FH" }),

    divider("Privacy", "divider_privacy", "shield"),
    // A living person's residence event is filtered; the place row for
    // their street is not, unless this says an event of a dead person
    // points at it. Trigger-maintained, so the filter stays flat.
    cached("has_public_reference", "$t:stemma_note_has_public_reference", { type: "boolean" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    divider("Names", "divider_names", "translate"),
    o2m("names", "{{name}} ({{valid_from}} – {{valid_to}})"),
    o2m("children", "{{name}}"),
    ...timestamps(),
  ],
  relations: [
    { collection: "places", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "places", field: "parent_place", related_collection: "places", meta: { one_field: "children" }, schema: SET_NULL },
  ],
};

/**
 * What a place was called, and when.
 *
 * Danzig → Gdańsk; Königsberg → Kaliningrad. An event dated 1890 shows
 * the name that was valid in 1890, not today's.
 */
export const placeNames: Collection = {
  collection: "place_names",
  meta: inDomain("places", {
    icon: "translate",
    note: "$t:stemma_note_place_names",
    sort: 31,
    display_template: "{{name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("place", "{{name}}", { required: true }),
    str("name", { required: true }),
    str("lang", { note: "$t:stemma_note_name_lang", placeholder: "de · pl · ru" }),
    date("valid_from", { note: "$t:stemma_note_valid_from" }),
    date("valid_to", { note: "$t:stemma_note_valid_to" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    ...timestamps(),
  ],
  relations: [
    { collection: "place_names", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "place_names", field: "place", related_collection: "places", meta: { one_field: "names" }, schema: CASCADE },
  ],
};
