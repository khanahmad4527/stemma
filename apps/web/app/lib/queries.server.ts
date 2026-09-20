/**
 * What each page asks Directus for, in one place.
 *
 * These were inline in the three loaders until the static demo needed the
 * same payloads at build time. Two copies of "which fields a chart page
 * needs" is the kind of duplication that goes wrong quietly: the loader
 * gains a field, the snapshot does not, and the demo renders one column
 * short with nothing failing.
 *
 * So each function takes its own `get` and returns exactly what the route
 * returns. At runtime that `get` carries the member's cookie; at build
 * time `scripts/snapshot.ts` supplies one with a static token. Same
 * queries, same shaping, one definition.
 */
import type { Person, Edge, Union, TreeData } from "~/lib/tree";
import type { PersonDetail } from "~/routes/person";

export type Get = <T>(path: string) => Promise<T>;

export type TreeRow = { id: string; name: string; slug: string; home_person: string | null };
export type TreeListRow = { id: string; name: string; slug: string; is_public: boolean };
export type Me = { first_name: string | null; last_name: string | null; email: string };

/** The tree picker: every tree the caller may see, and how many people are in it. */
export async function loadTrees(get: Get): Promise<{ trees: TreeListRow[]; me: Me; counts: Record<string, number> }> {
  // The member policy's filter does the work: this asks for every tree
  // and Directus returns only the ones they belong to.
  const [trees, me] = await Promise.all([
    get<TreeListRow[]>("/items/trees?limit=-1&fields=id,name,slug,is_public&sort=name"),
    get<Me>("/users/me?fields=first_name,last_name,email"),
  ]);
  const counts = await Promise.all(
    trees.map(async (t) => {
      const agg = await get<Array<{ count: { id: string } }>>(
        `/items/persons?aggregate%5Bcount%5D=id&filter%5Btree%5D%5B_eq%5D=${t.id}`,
      );
      return [t.id, Number(agg[0]?.count.id ?? 0)] as const;
    }),
  );
  return { trees, me, counts: Object.fromEntries(counts) as Record<string, number> };
}

/** Everything one chart page draws from. */
export async function loadTree(get: Get, slug: string): Promise<{ tree: TreeRow; data: TreeData }> {
  const trees = await get<TreeRow[]>(
    `/items/trees?limit=1&fields=id,name,slug,home_person&filter%5Bslug%5D%5B_eq%5D=${encodeURIComponent(slug)}`);
  const tree = trees[0];
  // A tree that does not exist and a tree you are not in look the same
  // from here, which is the correct answer to both.
  if (!tree) throw new Response("Not found", { status: 404 });

  const scope = `filter%5Btree%5D%5B_eq%5D=${tree.id}`;
  const [persons, edges, unions, vitals] = await Promise.all([
    get<Person[]>(`/items/persons?limit=-1&${scope}&sort=sort_name&fields=id,public_id,display_name,sort_name,sex_recorded,is_living,portrait,multiple_birth`),
    get<Edge[]>(`/items/parentage?limit=-1&${scope}&fields=parent,child,lineage,status`),
    get<Union[]>(`/items/couples?limit=-1&${scope}&fields=id,person_a,person_b`),
    // Only the two dates a chart label has room for. The rest of a
    // person's events load with their panel.
    get<Array<{ subject_person: string; date_earliest: string | null; is_conclusion: boolean;
                type: { code: string } | null; place: { name: string } | null }>>(
      `/items/events?limit=-1&${scope}&filter%5Btype%5D%5Bcode%5D%5B_in%5D=birth,death` +
      `&fields=subject_person,date_earliest,is_conclusion,type.code,place.name`),
  ]);

  // The conclusion wins; failing that, the earliest assertion — which
  // is what the Genealogical Proof Standard means by one of several
  // being concluded, rendered down to the four characters a box holds.
  const born = new Map<string, string>(), died = new Map<string, string>(), bplace = new Map<string, string>();
  for (const e of vitals) {
    if (!e.subject_person || !e.date_earliest) continue;
    const into = e.type?.code === "death" ? died : born;
    const have = into.get(e.subject_person);
    if (!have || e.is_conclusion) into.set(e.subject_person, e.date_earliest);
    if (e.type?.code === "birth" && e.place?.name && (!bplace.has(e.subject_person) || e.is_conclusion)) {
      bplace.set(e.subject_person, e.place.name);
    }
  }
  for (const p of persons) {
    p.born = born.get(p.id) ?? null;
    p.died = died.get(p.id) ?? null;
    p.birth_place = bplace.get(p.id) ?? null;
  }

  const data: TreeData = {
    slug: tree.slug, name: tree.name, persons, edges, unions, homePersonId: tree.home_person,
  };
  return { tree, data };
}

/** One person's detail, for the side panel. */
export async function loadPerson(get: Get, id: string): Promise<PersonDetail> {
  const [person, names, events, cites] = await Promise.all([
    get<PersonDetail>(
      `/items/persons/${id}?fields=id,display_name,sex_recorded,is_living,biography,public_id`),
    get<PersonDetail["names"]>(
      `/items/person_names?limit=-1&sort=sort_order&filter%5Bperson%5D%5B_eq%5D=${id}` +
      `&fields=id,type,given,particle,surname,patronymic,nickname,script_original,sort_order`),
    get<PersonDetail["events"]>(
      `/items/events?limit=-1&sort=date_earliest&filter%5Bsubject_person%5D%5B_eq%5D=${id}` +
      `&fields=id,date_original,date_earliest,value,is_conclusion,confidence,type.label,type.code,place.name,place_original`),
    get<Array<{ count: { id: string } }>>(
      `/items/citation_links?aggregate%5Bcount%5D=id&filter%5Bcollection%5D%5B_eq%5D=persons&filter%5Bitem%5D%5B_eq%5D=${id}`),
  ]);
  return { ...person, names, events, citations: Number(cites[0]?.count.id ?? 0) };
}
