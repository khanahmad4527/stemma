import {
  type Collection, pk, timestamps, m2o, o2m, dropdown, divider, str, text, int, bool, cached, treeRef,
  dated, confidence, restricted, CASCADE, SET_NULL,
} from "./_helpers.js";
import { inDomain } from "./_theme.js";

export const SEXES = ["male", "female", "intersex", "unknown"] as const;
export const LIVING_BASES = ["death_record", "presumed_by_age", "reported", "unknown"] as const;

/**
 * GEDCOM 7's name types plus the ones it lacks. `other` carries a free
 * phrase, because a closed list of name kinds is wrong by construction.
 */
export const NAME_TYPES = [
  "birth", "married", "aka", "immigrant", "professional", "adopted", "religious", "legal", "title", "other",
] as const;
export const NAME_ORDERS = ["given_first", "surname_first"] as const;

/**
 * The lineage vocabulary, and which of it is *descent*.
 *
 * `birth`, not `biological`: a baptism register asserts a child of, not a
 * genome. Descent lineages are the ones the acyclicity trigger walks —
 * birth, adoption, donor and surrogate edges cannot loop. Step, foster and
 * guardian edges can, legally, in the configuration the song is about.
 */
export const LINEAGES = ["birth", "adoptive", "step", "foster", "guardian", "donor", "surrogate", "sealing", "other"] as const;
export const DESCENT_LINEAGES = ["birth", "adoptive", "donor", "surrogate"] as const;
export const EDGE_STATUSES = ["asserted", "disputed", "disproven", "conclusion"] as const;

export const ASSOCIATION_TYPES = [
  "enslaved_by", "apprenticed_to", "employed_by", "servant_of", "tenant_of",
  "neighbour_of", "friend_of", "business_partner_of", "other",
] as const;

export const persons: Collection = {
  collection: "persons",
  meta: inDomain("graph", {
    icon: "person",
    note: "$t:stemma_note_persons",
    sort: 10,
    display_template: "{{display_name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    cached("display_name", "$t:stemma_note_person_display_name"),
    cached("sort_name", "$t:stemma_note_person_sort_name", { hidden: true }),
    cached("public_id", "$t:stemma_note_person_public_id"),
    // The face on every chart node. Gated until now on the
    // directus_files policy, which exists — a file is only ever public
    // when its media row says so and nobody in it is living.
    { field: "portrait", type: "uuid",
      meta: { interface: "file-image", special: ["file"], display: "image", width: "half",
              note: "$t:stemma_note_person_portrait" },
      schema: {} },
    dropdown("sex_recorded", SEXES, "unknown", { note: "$t:stemma_note_person_sex" }),

    divider("Privacy", "divider_privacy", "shield"),
    // Defaults to true — the safe direction. A person nobody has assessed
    // is withheld from the public rather than published.
    bool("is_living", true, { note: "$t:stemma_note_person_is_living", label: "Living" }),
    dropdown("living_basis", LIVING_BASES, "unknown", { note: "$t:stemma_note_living_basis" }),
    restricted(),
    // Twins and triplets share this. Not derivable from shared parents,
    // and GEDCOM has no marker for it, so it has to be stored.
    { field: "multiple_birth", type: "uuid",
      meta: { interface: "input", width: "half", note: "$t:stemma_note_multiple_birth" }, schema: {} },

    divider("Text", "divider_text", "notes"),
    text("biography", { rich: true, note: "$t:stemma_note_person_biography" }),
    text("notes", { rich: true, note: "$t:stemma_note_person_notes" }),

    divider("Names", "divider_names", "badge"),
    o2m("names", "{{given}} {{surname}} ({{type}})"),
    divider("Graph", "divider_graph", "family_history"),
    // The custom interface. An alias: it holds no column, because
    // everything it draws is already in parentage and couples.
    { field: "family_graph", type: "alias",
      meta: { interface: "person-graph", special: ["alias", "no-data"],
              options: { showEvents: true }, note: "$t:stemma_note_family_graph" },
      schema: null },
    // Both directions of the edge. No `partners` list beside them: a
    // couple is unordered, so the rows that concern a person are a union
    // of two relations, which is not an o2m. The graph interface does it.
    o2m("parents", "{{parent.display_name}} ({{lineage}})"),
    o2m("children", "{{child.display_name}} ({{lineage}})"),
    divider("Facts", "divider_facts", "event"),
    o2m("events", "{{type.label}} · {{date_original}}"),
    o2m("participations", "{{event.type.label}} as {{role}}"),
    ...timestamps(),
  ],
  relations: [
    { collection: "persons", field: "tree", related_collection: "trees", meta: { one_field: "persons" }, schema: CASCADE },
    // SET NULL: removing an image must not remove the person.
    { collection: "persons", field: "portrait", related_collection: "directus_files", meta: {}, schema: SET_NULL },
  ],
};

export const personNames: Collection = {
  collection: "person_names",
  meta: {
    ...inDomain("graph", {
      icon: "badge",
      note: "$t:stemma_note_person_names",
      sort: 11,
      display_template: "{{given}} {{surname}}",
    }),
    sort_field: "sort_order",
  },
  fields: [
    pk(),
    treeRef(),
    m2o("person", "{{display_name}}", { required: true }),
    dropdown("type", NAME_TYPES, "birth", { note: "$t:stemma_note_name_type", required: true }),
    str("type_phrase", { note: "$t:stemma_note_name_type_phrase" }),

    divider("Name", "divider_name", "badge"),
    str("prefix", { note: "$t:stemma_note_name_prefix" }),
    str("given", { note: "$t:stemma_note_name_given" }),
    // Displayed with the surname, sorted without it — or with it, per the
    // tree's tradition. Without this column every Dutch family is under V.
    str("particle", { note: "$t:stemma_note_name_particle" }),
    str("surname", { note: "$t:stemma_note_name_surname" }),
    str("patronymic", { note: "$t:stemma_note_name_patronymic" }),
    str("suffix", { note: "$t:stemma_note_name_suffix" }),
    str("nickname", { note: "$t:stemma_note_name_nickname" }),

    divider("Script and order", "divider_script", "translate"),
    str("script_original", { note: "$t:stemma_note_name_script_original" }),
    str("lang", { note: "$t:stemma_note_name_lang", placeholder: "he · ar · ru · zh-Hant" }),
    dropdown("name_order", NAME_ORDERS, null, { note: "$t:stemma_note_name_order" }),
    { field: "parts", type: "json",
      meta: { interface: "input-code", options: { language: "json" }, display: "formatted-json-value",
              display_options: { format: "{{type}}: {{value}}" }, width: "full", note: "$t:stemma_note_name_parts" },
      schema: {} },
    int("sort_order", { def: 1, hidden: true, note: "$t:stemma_note_name_sort_order" }),
    // The event that gave this name its date — a marriage, a
    // naturalisation, a profession.
    m2o("event", "{{type.label}} · {{date_original}}", { note: "$t:stemma_note_name_event" }),
    ...timestamps(),
  ],
  relations: [
    { collection: "person_names", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "person_names", field: "person", related_collection: "persons",
      meta: { one_field: "names", sort_field: "sort_order" }, schema: CASCADE },
    { collection: "person_names", field: "event", related_collection: "events", meta: {}, schema: SET_NULL },
  ],
};

export const couples: Collection = {
  collection: "couples",
  meta: inDomain("graph", {
    icon: "favorite",
    note: "$t:stemma_note_couples",
    sort: 12,
    display_template: "{{person_a.display_name}} & {{person_b.display_name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("person_a", "{{display_name}}", { required: true, note: "$t:stemma_note_couple_person" }),
    m2o("person_b", "{{display_name}}", { required: true, note: "$t:stemma_note_couple_person" }),
    int("sort", { note: "$t:stemma_note_couple_sort" }),
    restricted(),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    divider("Events", "divider_events", "event"),
    o2m("events", "{{type.label}} · {{date_original}}"),
    ...timestamps(),
  ],
  relations: [
    { collection: "couples", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "couples", field: "person_a", related_collection: "persons", meta: {}, schema: CASCADE },
    { collection: "couples", field: "person_b", related_collection: "persons", meta: {}, schema: CASCADE },
  ],
};

export const parentage: Collection = {
  collection: "parentage",
  meta: inDomain("graph", {
    icon: "family_history",
    note: "$t:stemma_note_parentage",
    sort: 13,
    display_template: "{{parent.display_name}} → {{child.display_name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("parent", "{{display_name}}", { required: true, note: "$t:stemma_note_parentage_parent" }),
    m2o("child", "{{display_name}}", { required: true, note: "$t:stemma_note_parentage_child" }),
    dropdown("lineage", LINEAGES, "birth", { note: "$t:stemma_note_parentage_lineage", required: true }),
    str("lineage_phrase", { note: "$t:stemma_note_lineage_phrase" }),

    divider("Evidence", "divider_evidence", "gavel"),
    // An edge is an assertion. A disproven one is kept, marked and hidden
    // from charts: the wrong answer stays on file with the reason.
    dropdown("status", EDGE_STATUSES, "asserted", { note: "$t:stemma_note_edge_status", required: true,
      colors: { asserted: "#3399FF", disputed: "#FFA439", disproven: "#E35169", conclusion: "#2ECDA7" } }),
    confidence(),
    m2o("event", "{{type.label}} · {{date_original}}", { note: "$t:stemma_note_edge_event" }),
    restricted(),
    // Birth order among siblings when the dates are missing.
    int("sort", { note: "$t:stemma_note_edge_sort" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    ...timestamps(),
  ],
  relations: [
    { collection: "parentage", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "parentage", field: "parent", related_collection: "persons", meta: { one_field: "children" }, schema: CASCADE },
    { collection: "parentage", field: "child", related_collection: "persons", meta: { one_field: "parents" }, schema: CASCADE },
    { collection: "parentage", field: "event", related_collection: "events", meta: {}, schema: SET_NULL },
  ],
};

/**
 * Relationships that are neither descent nor union.
 *
 * Enslaved-by is the important one — for African-American genealogy the
 * enslaver's records are often the only records. Directed: person_a is
 * the one the type describes, person_b the other party. Roles *within an
 * event* (witness, godparent, informant) are not here; they are
 * event_participants.
 */
export const associations: Collection = {
  collection: "associations",
  meta: inDomain("graph", {
    icon: "handshake",
    note: "$t:stemma_note_associations",
    sort: 14,
    display_template: "{{person_a.display_name}} {{type}} {{person_b.display_name}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("person_a", "{{display_name}}", { required: true, note: "$t:stemma_note_association_a" }),
    dropdown("type", ASSOCIATION_TYPES, "other", { required: true, note: "$t:stemma_note_association_type" }),
    m2o("person_b", "{{display_name}}", { required: true, note: "$t:stemma_note_association_b" }),
    str("type_phrase", { note: "$t:stemma_note_association_phrase" }),
    divider("When", "divider_when", "event"),
    ...dated(),
    restricted(),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    ...timestamps(),
  ],
  relations: [
    { collection: "associations", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "associations", field: "person_a", related_collection: "persons", meta: {}, schema: CASCADE },
    { collection: "associations", field: "person_b", related_collection: "persons", meta: {}, schema: CASCADE },
  ],
};
