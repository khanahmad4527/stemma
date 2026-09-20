import {
  type Collection, pk, timestamps, m2o, o2m, dropdown, divider, str, text, int, bool, cached, treeRef,
  treeRefOptional, dated, confidence, restricted, CASCADE, SET_NULL,
} from "./_helpers.js";
import { inDomain } from "./_theme.js";

export const APPLIES_TO = ["person", "couple", "either"] as const;
export const EVENT_CATEGORIES = [
  "vital", "religious", "civil", "residence", "occupation", "education", "military", "legal",
  "property", "migration", "attribute", "other",
] as const;

export const PARTICIPANT_ROLES = [
  "principal", "spouse", "parent", "child", "sibling", "witness", "godparent", "sponsor", "officiant",
  "informant", "beneficiary", "executor", "household_member", "employer", "employee", "enslaver", "enslaved", "other",
] as const;

/**
 * The event vocabulary is a collection, not an enum.
 *
 * GEDCOM 7 has some forty event and attribute tags; users need ones it
 * lacks — Heimat, manumission, banns. A row with `tree` NULL is global
 * and admin-owned; a tree may add its own. `is_vital` marks the ones the
 * timeline summary and the is_living trigger care about; `gedcom_tag`
 * NULL exports as `EVEN` with a `TYPE`.
 */
export const eventTypes: Collection = {
  collection: "event_types",
  meta: {
    ...inDomain("events", {
      icon: "category",
      note: "$t:stemma_note_event_types",
      sort: 20,
      display_template: "{{label}}",
    }),
    sort_field: "sort",
  },
  fields: [
    pk(),
    treeRefOptional(),
    str("code", { required: true, note: "$t:stemma_note_event_type_code" }),
    str("label", { required: true, note: "$t:stemma_note_event_type_label" }),
    dropdown("applies_to", APPLIES_TO, "person", { required: true, note: "$t:stemma_note_applies_to" }),
    dropdown("category", EVENT_CATEGORIES, "other", { required: true }),
    bool("is_vital", false, { note: "$t:stemma_note_is_vital", label: "Vital" }),
    // Which vital events end a life. Read by the trigger that flips
    // is_living; a user-defined "funeral" type can set it too.
    bool("ends_life", false, { note: "$t:stemma_note_ends_life", label: "Ends life" }),
    str("gedcom_tag", { note: "$t:stemma_note_gedcom_tag", placeholder: "BIRT · DEAT · MARR · EVEN" }),
    int("sort", { hidden: true }),
    ...timestamps(),
  ],
  relations: [
    { collection: "event_types", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
  ],
};

/**
 * Where the facts live.
 *
 * Birth, death, baptism, census, occupation, immigration: columns on
 * persons run out; this table does not. An event is filed under exactly
 * one subject — a person or a couple — and may name any number of other
 * people through event_participants.
 *
 * Two of one type on one person is the intended representation of "two
 * censuses give different birth years": both kept, both cited, at most
 * one marked as the conclusion (a partial unique index, constraints.ts).
 */
export const events: Collection = {
  collection: "events",
  meta: inDomain("events", {
    icon: "event",
    note: "$t:stemma_note_events",
    sort: 21,
    display_template: "{{type.label}} · {{date_original}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("type", "{{label}}", { required: true, note: "$t:stemma_note_event_type" }),
    m2o("subject_person", "{{display_name}}", { note: "$t:stemma_note_subject_person" }),
    m2o("subject_couple", "{{person_a.display_name}} & {{person_b.display_name}}", { note: "$t:stemma_note_subject_couple" }),
    // OCCU Blacksmith · RELI Roman Catholic · cause of death. GEDCOM
    // attributes carry a value; so do ours.
    str("value", { note: "$t:stemma_note_event_value", width: "full" }),

    divider("When", "divider_when", "event"),
    ...dated(),
    { field: "date_time", type: "time", meta: { interface: "datetime", width: "half", note: "$t:stemma_note_date_time" }, schema: {} },
    // "aged 74" on a death certificate is the evidence for a calculated
    // birth year. Keep the age; it is what the record says.
    str("age_recorded", { note: "$t:stemma_note_age_recorded", placeholder: "aged 74 · 3 mos · abt 40" }),

    divider("Where", "divider_where", "place"),
    m2o("place", "{{name}}", { note: "$t:stemma_note_event_place" }),
    str("place_original", { note: "$t:stemma_note_place_original", placeholder: "Danzig, Westpreußen" }),

    divider("Evidence", "divider_evidence", "gavel"),
    bool("is_conclusion", false, { note: "$t:stemma_note_is_conclusion", label: "Conclusion" }),
    confidence(),
    restricted(),
    cached("has_living_participant", "$t:stemma_note_has_living_participant", { type: "boolean", hidden: true }),
    int("sort", { hidden: true }),

    divider("Text", "divider_text", "notes"),
    text("description", { note: "$t:stemma_note_event_description" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    divider("People", "divider_people", "groups"),
    o2m("participants", "event_participants", "{{person.display_name}} — {{role}}"),
    ...timestamps(),
  ],
  relations: [
    { collection: "events", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    // RESTRICT rather than cascade: deleting an event type that is in use
    // is a mistake, and the database should say so.
    { collection: "events", field: "type", related_collection: "event_types", meta: {}, schema: { on_delete: "RESTRICT" } },
    { collection: "events", field: "subject_person", related_collection: "persons", meta: { one_field: "events" }, schema: CASCADE },
    { collection: "events", field: "subject_couple", related_collection: "couples", meta: { one_field: "events" }, schema: CASCADE },
    { collection: "events", field: "place", related_collection: "places", meta: {}, schema: SET_NULL },
  ],
};

/**
 * Everyone in an event who is not its subject.
 *
 * A baptism has a child, two parents, two godparents and a priest. A
 * census is a household. A will has a testator, beneficiaries, witnesses
 * and an executor. One event, many participants, one place, one date —
 * rather than eight census events nobody can see belong together.
 *
 * A participant row naming a living person is filtered like a name row,
 * and its presence sets `events.has_living_participant`.
 */
export const eventParticipants: Collection = {
  collection: "event_participants",
  meta: inDomain("events", {
    icon: "groups",
    note: "$t:stemma_note_event_participants",
    sort: 22,
    display_template: "{{person.display_name}} — {{role}}",
  }),
  fields: [
    pk(),
    treeRef(),
    m2o("event", "{{type.label}} · {{date_original}}", { required: true }),
    m2o("person", "{{display_name}}", { required: true }),
    dropdown("role", PARTICIPANT_ROLES, "other", { required: true, note: "$t:stemma_note_participant_role" }),
    str("role_phrase", { note: "$t:stemma_note_role_phrase" }),
    // What the record said about them here: "aged 12, scholar" on a census line.
    str("detail", { note: "$t:stemma_note_participant_detail", width: "full" }),
    text("notes", { note: "$t:stemma_note_private_notes" }),
    ...timestamps(),
  ],
  relations: [
    { collection: "event_participants", field: "tree", related_collection: "trees", meta: {}, schema: CASCADE },
    { collection: "event_participants", field: "event", related_collection: "events", meta: { one_field: "participants" }, schema: CASCADE },
    { collection: "event_participants", field: "person", related_collection: "persons", meta: { one_field: "participations" }, schema: CASCADE },
  ],
};
