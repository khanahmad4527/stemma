<script setup lang="ts">
/**
 * The person's immediate graph, drawn on their own form.
 *
 * ── Why an interface and not a panel or a page ─────────────────────────
 *
 * The single most common thing a contributor does is arrive at a person
 * and ask "who is this connected to, and is that right?". Answering it
 * through the relational lists means reading four o2m tables of raw
 * rows; answering it here means looking at it. The Data Studio is where
 * the editing happens, so the navigation belongs there too.
 *
 * ── It stores nothing ──────────────────────────────────────────────────
 *
 * Everything on screen is already in `parentage` and `couples`. The field
 * is an alias with no column, and this component only reads — the same
 * argument as `display_name` being a cache rather than a second source
 * of truth. A person's relatives are never written from here.
 *
 * ── Two Directus details worth knowing ─────────────────────────────────
 *
 * `useApi()` is injected by the app and already carries the signed-in
 * user's credentials, so every read below is filtered by that person's
 * own permissions — a viewer of one tree cannot pull a relative out of
 * another through this interface. Doing the fetches with a bare `fetch`
 * would have bypassed that.
 *
 * `primaryKey` is `"+"` while the item is new. There is nothing to draw
 * for a person who does not exist yet, and asking the API for `/items/
 * persons/+` is a 403 that looks like a permissions bug.
 */
import { computed, ref, watch } from "vue";
import { useApi, useStores } from "@directus/extensions-sdk";

type Person = {
  id: string;
  display_name: string | null;
  sex_recorded: string | null;
  is_living: boolean;
  portrait: string | null;
};
type Edge = { id: string; parent: Person | null; child: Person | null; lineage: string; status: string };
type Union = { id: string; person_a: Person | null; person_b: Person | null };
type Ev = { id: string; date_original: string | null; type: { label: string } | null };

const props = withDefaults(defineProps<{
  primaryKey?: string | number | null;
  showEvents?: boolean;
}>(), { primaryKey: null, showEvents: true });

const api = useApi();
const { useNotificationsStore } = useStores();
const notifications = useNotificationsStore();

const loading = ref(false);
const error = ref<string | null>(null);
const self = ref<Person | null>(null);
const parents = ref<Edge[]>([]);
const children = ref<Edge[]>([]);
const unions = ref<Union[]>([]);
const events = ref<Ev[]>([]);

const PERSON = "id,display_name,sex_recorded,is_living,portrait";

/** A new, unsaved item has no graph and no id worth asking about. */
const saved = computed(() => {
  const k = props.primaryKey;
  return typeof k === "string" && k !== "+" && k.length > 0;
});

async function load(): Promise<void> {
  if (!saved.value) return;
  const id = props.primaryKey as string;
  loading.value = true;
  error.value = null;
  try {
    const [me, up, down, pairs, evs] = await Promise.all([
      api.get(`/items/persons/${id}`, { params: { fields: PERSON } }),
      api.get("/items/parentage", {
        params: { limit: -1, filter: { child: { _eq: id } }, fields: `id,lineage,status,parent.${PERSON.replace(/,/g, ",parent.")}` },
      }),
      api.get("/items/parentage", {
        params: { limit: -1, filter: { parent: { _eq: id } }, fields: `id,lineage,status,child.${PERSON.replace(/,/g, ",child.")}` },
      }),
      api.get("/items/couples", {
        params: {
          limit: -1,
          filter: { _or: [{ person_a: { _eq: id } }, { person_b: { _eq: id } }] },
          fields: `id,person_a.${PERSON.replace(/,/g, ",person_a.")},person_b.${PERSON.replace(/,/g, ",person_b.")}`,
        },
      }),
      props.showEvents
        ? api.get("/items/events", {
            params: { limit: 6, sort: "date_earliest", filter: { subject_person: { _eq: id } },
                      fields: "id,date_original,type.label" },
          })
        : Promise.resolve({ data: { data: [] } }),
    ]);
    self.value = me.data.data;
    // A disproven edge stays on file and off the chart — the reasoning is
    // the point of keeping it, not the line.
    parents.value = (up.data.data as Edge[]).filter((e) => e.status !== "disproven");
    children.value = (down.data.data as Edge[]).filter((e) => e.status !== "disproven");
    unions.value = pairs.data.data;
    events.value = evs.data.data;
  } catch (e) {
    const msg = (e as { response?: { data?: { errors?: Array<{ message: string }> } } })
      ?.response?.data?.errors?.[0]?.message ?? "Could not load this person's family.";
    error.value = msg;
    notifications.add({ title: "Person graph", text: msg, type: "error" });
  } finally {
    loading.value = false;
  }
}

watch(() => props.primaryKey, load, { immediate: true });

/** The other half of each union. */
const partners = computed(() =>
  unions.value
    .map((u) => (u.person_a?.id === props.primaryKey ? u.person_b : u.person_a))
    .filter((p): p is Person => !!p));

/*
 * Shape carries sex, a stroke carries death — the NSGC standardized
 * pedigree nomenclature, the same as the public site. Never colour: it
 * survives a printer and every kind of colour-blindness, and the usual
 * alternative for sex is pink and blue, which is a stereotype and
 * invisible to the commonest CVD.
 */
function symbol(sex: string | null, r = 9): string {
  switch (sex) {
    case "male": return `M${-r},${-r} H${r} V${r} H${-r} Z`;
    case "female": return `M${-r},0 a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
    default: return `M0,${-r * 1.25} L${r * 1.25},0 L0,${r * 1.25} L${-r * 1.25},0 Z`;
  }
}

const LINEAGE: Record<string, string> = {
  birth: "", adoptive: "adoptive", step: "step", foster: "foster",
  guardian: "guardian", donor: "donor", surrogate: "surrogate", sealing: "sealing", other: "other",
};

/** Navigate within the Data Studio rather than reloading the app. */
function open(id: string): void {
  window.location.hash = `#/content/persons/${id}`;
}
</script>

<template>
  <div class="person-graph">
    <v-notice v-if="!saved" type="info">
      Save this person and their family will appear here.
    </v-notice>

    <v-progress-circular v-else-if="loading" indeterminate />

    <v-notice v-else-if="error" type="danger">{{ error }}</v-notice>

    <template v-else>
      <div v-for="group in [
            { key: 'parents', title: 'Parents', rows: parents.map(e => ({ id: e.id, person: e.parent, note: LINEAGE[e.lineage], status: e.status })) },
            { key: 'partners', title: 'Partners', rows: partners.map(p => ({ id: p.id, person: p, note: '', status: '' })) },
            { key: 'children', title: 'Children', rows: children.map(e => ({ id: e.id, person: e.child, note: LINEAGE[e.lineage], status: e.status })) },
          ]" :key="group.key" class="group">
        <div class="heading">{{ group.title }}</div>
        <p v-if="!group.rows.length" class="none">None recorded.</p>
        <ul v-else>
          <li v-for="row in group.rows" :key="row.id">
            <button type="button" class="rel" @click="row.person && open(row.person.id)">
              <svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden="true">
                <path class="sym" :d="symbol(row.person?.sex_recorded ?? null)" />
                <line v-if="row.person && !row.person.is_living"
                      class="dead" x1="-10" y1="10" x2="10" y2="-10" />
              </svg>
              <span class="name">{{ row.person?.display_name ?? "—" }}</span>
              <span v-if="row.note" class="tag">{{ row.note }}</span>
              <span v-if="row.status === 'disputed'" class="tag warn">disputed</span>
              <span v-if="row.person?.is_living" class="tag living">living</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="showEvents && events.length" class="group">
        <div class="heading">Events</div>
        <ul class="events">
          <li v-for="e in events" :key="e.id">
            <span class="what">{{ e.type?.label ?? "Event" }}</span>
            <span class="when">{{ e.date_original ?? "—" }}</span>
          </li>
        </ul>
      </div>

      <p class="footnote">
        Read only — edit the family through <strong>Parentage</strong> and
        <strong>Couples</strong>. □ male · ○ female · ◇ unrecorded · a stroke means deceased.
      </p>
    </template>
  </div>
</template>

<style scoped>
/*
 * Directus theme variables throughout, so this follows whatever theme
 * the operator has chosen rather than pinning its own colours and
 * looking foreign in a dark Data Studio.
 */
.person-graph { display: grid; gap: 16px; }
.group { display: grid; gap: 6px; }
.heading {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--theme--foreground-subdued); font-weight: 600;
}
.none { margin: 0; color: var(--theme--foreground-subdued); font-size: 13px; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.rel {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 5px 8px; border: 0; border-radius: var(--theme--border-radius);
  background: transparent; cursor: pointer; font: inherit; text-align: left;
  color: var(--theme--foreground);
}
.rel:hover { background: var(--theme--background-subdued); }
.sym { fill: var(--theme--background-normal); stroke: var(--theme--foreground-subdued); stroke-width: 1.5; }
.dead { stroke: var(--theme--foreground); stroke-width: 1.5; }
.name { font-weight: 500; }
.tag {
  font-size: 11px; padding: 1px 7px; border-radius: 99px;
  border: 1px solid var(--theme--border-color);
  color: var(--theme--foreground-subdued);
}
.tag.warn { border-color: var(--theme--warning); color: var(--theme--warning); }
.tag.living { border-color: var(--theme--primary); color: var(--theme--primary); }
.events { font-size: 13px; }
.events li { display: flex; gap: 10px; padding: 3px 8px; }
.events .when { color: var(--theme--foreground-subdued); }
.footnote {
  margin: 0; font-size: 12px; color: var(--theme--foreground-subdued);
  border-top: 1px solid var(--theme--border-color); padding-top: 10px; line-height: 1.5;
}
</style>
