/**
 * The small declarative layer the authoring modules are written in.
 *
 * Every helper here exists because a Directus field has two halves that
 * are easy to set one-and-not-the-other: `interface` decides what the
 * form shows, `display` decides what a list or a related-values chip
 * shows. Miss the second and the admin renders raw uuids and raw enum
 * values. The helpers set both, every time, so the fortieth field cannot
 * forget.
 */

export type Field = {
  field: string;
  type: string;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown> | null;
};

export type Relation = {
  collection: string;
  field: string;
  related_collection: string | null;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown> | null;
};

export type Collection = {
  collection: string;
  meta: Record<string, unknown>;
  fields: Field[];
  relations?: Relation[];
};

export type Choice = { text: string; value: string | number; color?: string };

export const CASCADE = { on_delete: "CASCADE" };
export const SET_NULL = { on_delete: "SET NULL" };

/**
 * The collapsed box at the foot of every form.
 *
 * `id` and the four audit columns used to be `hidden: true`, which is the
 * lazy way to keep a form tidy: it also means a contributor asking "who
 * changed this, and when" has nowhere to look, and that a uuid you need
 * in order to file a bug can only be read out of the address bar. A
 * closed group hides them by default and still answers the question in
 * one click.
 *
 * Sorts are explicit and high so the box is always last, whatever order
 * the fields above it were added in.
 */
export const SYSTEM_GROUP = "system";

export const systemGroup = (): Field => ({
  field: SYSTEM_GROUP,
  type: "alias",
  meta: {
    interface: "group-detail",
    special: ["alias", "no-data", "group"],
    options: { start: "closed", headerIcon: "manage_history" },
    note: "$t:stemma_note_system_group",
    sort: 90,
  },
  schema: null,
});

/** Primary key used everywhere: uuid. Directus generates it; the DB has a default too (constraints.ts). */
export const pk = (): Field => ({
  field: "id",
  type: "uuid",
  meta: {
    readonly: true, interface: "input", special: ["uuid"],
    display: "formatted-value", display_options: { font: "monospace" },
    group: SYSTEM_GROUP, sort: 91, width: "full", note: "$t:stemma_note_system_id",
  },
  schema: { is_primary_key: true, has_auto_increment: false },
});

/**
 * The audit columns, with the displays that stop them rendering as raw
 * data. Without `display: "user"` a list column for `user_created` shows
 * a uuid — the single most common way a Directus instance looks
 * unfinished — and without `display: "datetime"` a timestamp arrives as
 * an ISO string with a `Z` on the end.
 */
export const timestamps = (): Field[] => [
  systemGroup(),
  { field: "date_created", type: "timestamp",
    meta: { special: ["date-created"], interface: "datetime", readonly: true, width: "half",
            display: "datetime", display_options: { relative: true },
            group: SYSTEM_GROUP, sort: 92 }, schema: {} },
  { field: "user_created", type: "uuid",
    meta: { special: ["user-created"], interface: "select-dropdown-m2o", readonly: true, width: "half",
            display: "user", display_options: { display: "name", circle: true },
            options: { template: "{{first_name}} {{last_name}}" },
            group: SYSTEM_GROUP, sort: 93 }, schema: {} },
  { field: "date_updated", type: "timestamp",
    meta: { special: ["date-updated"], interface: "datetime", readonly: true, width: "half",
            display: "datetime", display_options: { relative: true },
            group: SYSTEM_GROUP, sort: 94 }, schema: {} },
  { field: "user_updated", type: "uuid",
    meta: { special: ["user-updated"], interface: "select-dropdown-m2o", readonly: true, width: "half",
            display: "user", display_options: { display: "name", circle: true },
            options: { template: "{{first_name}} {{last_name}}" },
            group: SYSTEM_GROUP, sort: 95 }, schema: {} },
];

type Common = { note?: string; width?: "half" | "full"; required?: boolean; hidden?: boolean };

const common = (o: Common): Record<string, unknown> => ({
  width: o.width ?? "half",
  ...(o.required ? { required: true } : {}),
  ...(o.note ? { note: o.note } : {}),
  ...(o.hidden ? { hidden: true } : {}),
});

export const m2o = (field: string, template: string, o: Common = {}): Field => ({
  field,
  type: "uuid",
  meta: {
    interface: "select-dropdown-m2o",
    special: ["m2o"],
    display: "related-values",
    display_options: { template },
    options: { template },
    ...common(o),
  },
  schema: o.required ? { is_nullable: false } : {},
});

/**
 * The far side of a many-to-one. Directus does not create it when the
 * relation is posted through the API — the Data Studio makes both — and
 * `d6s sync pull` only warns.
 */
export const o2m = (field: string, template: string, note?: string): Field => ({
  field,
  type: "alias",
  meta: {
    interface: "list-o2m",
    special: ["o2m"],
    display: "related-values",
    display_options: { template },
    options: { template, layout: "list" },
    ...(note ? { note } : {}),
  },
  schema: null,
});

/** Choice labels are `$t:` keys named after the value — see strings.ts. */
export const choices = (values: readonly string[], colors: Record<string, string> = {}): Choice[] =>
  values.map((value) => ({
    text: `$t:stemma_c_${value}`,
    value,
    ...(colors[value] ? { color: colors[value] } : {}),
  }));

/**
 * A dropdown with the display its interface implies, so a list shows
 * "Biological" where the value is `biological` — and, once translated,
 * shows the Dutch label rather than the English value.
 */
export const dropdown = (
  field: string,
  values: readonly string[] | Choice[],
  defaultValue: string | number | null,
  o: Common & { type?: "string" | "integer"; colors?: Record<string, string> } = {},
): Field => {
  const list: Choice[] = typeof values[0] === "string"
    ? choices(values as string[], o.colors ?? {})
    : (values as Choice[]);
  return {
    field,
    type: o.type ?? "string",
    meta: {
      interface: "select-dropdown",
      display: "labels",
      display_options: { choices: list },
      options: { choices: list },
      ...common(o),
    },
    schema: defaultValue === null ? {} : { default_value: defaultValue, is_nullable: false },
  };
};

export const divider = (title: string, key: string, icon = "info"): Field => ({
  field: key,
  type: "alias",
  meta: { interface: "presentation-divider", special: ["alias", "no-data"], options: { title, icon } },
  schema: null,
});

export const str = (field: string, o: Common & { unique?: boolean; placeholder?: string } = {}): Field => ({
  field, type: "string",
  meta: { interface: "input", display: "formatted-value", ...common(o), ...(o.placeholder ? { options: { placeholder: o.placeholder } } : {}) },
  schema: { ...(o.required ? { is_nullable: false } : {}), ...(o.unique ? { is_unique: true } : {}) },
});

export const text = (field: string, o: Common & { rich?: boolean } = {}): Field => ({
  field, type: "text",
  meta: { interface: o.rich ? "input-rich-text-md" : "input-multiline",
          display: "formatted-value", display_options: { format: true },
          ...common({ ...o, width: o.width ?? "full" }) },
  schema: {},
});

export const int = (field: string, o: Common & { def?: number } = {}): Field => ({
  field, type: "integer",
  meta: { interface: "input", display: "formatted-value", ...common(o) },
  schema: o.def === undefined ? {} : { default_value: o.def },
});

export const float = (field: string, o: Common = {}): Field => ({
  field, type: "float", meta: { interface: "input", display: "formatted-value", ...common(o) }, schema: {},
});

/**
 * A URL. Its own helper because the interface wants a link affordance and
 * a list wants the host rather than 120 characters of query string.
 */
export const url = (field: string, o: Common = {}): Field => ({
  field, type: "string",
  meta: {
    interface: "input", display: "formatted-value",
    options: { iconRight: "link", placeholder: "https://" },
    display_options: { font: "monospace" },
    ...common(o),
  },
  schema: {},
});

/**
 * The `collection` half of a many-to-any junction.
 *
 * Hidden on the form — Directus writes it when you pick the related item,
 * and offering it separately invites a row whose `collection` and `item`
 * disagree. Visible in a list, though, which is why the display matters:
 * the `collection` display renders the collection's icon and translated
 * name, and without it the column reads `person_names`, which is the
 * table name and not what anyone calls it.
 */
export const collectionRef = (field: string): Field => ({
  field, type: "string",
  meta: { interface: "system-collection", display: "collection", hidden: true },
  schema: { is_nullable: false },
});

export const bool = (field: string, def: boolean, o: Common & { label?: string } = {}): Field => ({
  field, type: "boolean",
  meta: { interface: "boolean", display: "boolean", ...common(o), options: { label: o.label ?? "" } },
  schema: { default_value: def, is_nullable: false },
});

export const date = (field: string, o: Common = {}): Field => ({
  field, type: "date", meta: { interface: "datetime", display: "datetime", ...common(o) }, schema: {},
});


/**
 * A column the database maintains and nobody edits.
 *
 * `display_name`, `sort_name`, `public_id`, `has_living_participant` —
 * caches, not second sources of truth: nothing may write them but the
 * trigger, nothing decides on them that could not be decided from the
 * source rows, and dropping them loses no information.
 */
export const cached = (field: string, note: string, o: { type?: "string" | "boolean"; width?: "half" | "full"; hidden?: boolean } = {}): Field =>
  o.type === "boolean"
    ? { field, type: "boolean", meta: { interface: "boolean", display: "boolean", readonly: true, width: o.width ?? "half", note, ...(o.hidden ? { hidden: true } : {}) },
        schema: { default_value: false, is_nullable: false } }
    : { field, type: "string", meta: { interface: "input", display: "formatted-value", readonly: true, width: o.width ?? "half", note, ...(o.hidden ? { hidden: true } : {}) },
        schema: {} };

/** The tenancy column every collection carries. */
export const treeRef = (): Field => m2o("tree", "{{name}}", { required: true, note: "$t:stemma_note_row_tree" });

/** For the one lookup whose rows may be global: `tree` NULL means every tree sees it. */
export const treeRefOptional = (): Field => m2o("tree", "{{name}}", { note: "$t:stemma_note_row_tree_optional" });

export const DATE_QUALIFIERS = [
  "exact", "about", "before", "after", "between", "period", "estimated", "calculated", "interpreted", "phrase",
] as const;

export const CALENDARS = [
  "gregorian", "julian", "hebrew", "french_republican", "islamic", "japanese", "ethiopian", "coptic", "quaker", "other",
] as const;

/**
 * A genealogical date. Five columns, never one.
 *
 * `date_original` is what the source says, verbatim, and is never parsed
 * away. The other four are derived from it and can be corrected by hand.
 * Open ends (`before 1900`) leave `date_earliest` NULL; the expression
 * index in constraints.ts turns the pair into a `daterange` where a NULL
 * bound means unbounded, so range queries work without the columns
 * holding a value Directus cannot render.
 */
export const dated = (): Field[] => [
  str("date_original", {
    note: "$t:stemma_note_date_original",
    placeholder: "abt 1850 · bef 1900 · bet 1852 and 1855 · 24 Feb 1750/51",
  }),
  dropdown("date_qualifier", DATE_QUALIFIERS, null, { note: "$t:stemma_note_date_qualifier" }),
  date("date_earliest", { note: "$t:stemma_note_date_earliest" }),
  date("date_latest", { note: "$t:stemma_note_date_latest" }),
  dropdown("date_calendar", CALENDARS, null, { note: "$t:stemma_note_date_calendar" }),
];

/** GEDCOM QUAY: the scale citations export to without translation. */
export const CONFIDENCE: Choice[] = [
  { text: "$t:stemma_c_confidence_0", value: 0, color: "#A2B5CD" },
  { text: "$t:stemma_c_confidence_1", value: 1, color: "#FFA439" },
  { text: "$t:stemma_c_confidence_2", value: 2, color: "#3399FF" },
  { text: "$t:stemma_c_confidence_3", value: 3, color: "#2ECDA7" },
];

export const confidence = (note = "$t:stemma_note_confidence"): Field =>
  dropdown("confidence", CONFIDENCE, null, { type: "integer", note });

export const restricted = (): Field =>
  bool("is_restricted", false, { note: "$t:stemma_note_is_restricted", label: "Restricted" });
