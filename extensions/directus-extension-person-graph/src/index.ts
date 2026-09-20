import { defineInterface } from "@directus/extensions-sdk";
import PersonGraph from "./interface.vue";

/**
 * The immediate family of a person, on their own form.
 *
 * An **alias** interface: it stores nothing. The field it mounts on has
 * `special: ["alias", "no-data"]` and holds no column, because everything
 * on screen is already in `parentage` and `couples` and a second copy
 * would be a second source of truth.
 *
 * `relational: false` and `hideLabel` because the thing renders its own
 * headings; `types: ["alias"]` so Directus only offers it where it can
 * actually work.
 */
export default defineInterface({
  id: "person-graph",
  name: "$t:stemma_iface_person_graph",
  icon: "family_history",
  description: "$t:stemma_iface_person_graph_desc",
  component: PersonGraph,
  hideLabel: true,
  types: ["alias"],
  localTypes: ["presentation"],
  group: "presentation",
  relational: false,
  options: [
    {
      field: "showEvents",
      name: "$t:stemma_iface_show_events",
      type: "boolean",
      meta: { width: "half", interface: "boolean" },
      schema: { default_value: true },
    },
  ],
});
