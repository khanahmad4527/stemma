import type { Route } from "./+types/person";
import { withDirectus } from "~/lib/directus.server";

export type PersonDetail = {
  id: string;
  display_name: string | null;
  sex_recorded: string | null;
  is_living: boolean;
  biography: string | null;
  public_id: string | null;
  names: Array<{ id: string; type: string; given: string | null; particle: string | null; surname: string | null;
                 patronymic: string | null; nickname: string | null; script_original: string | null; sort_order: number | null }>;
  events: Array<{ id: string; date_original: string | null; date_earliest: string | null; value: string | null;
                  is_conclusion: boolean; confidence: number | null;
                  type: { label: string; code: string } | null;
                  place: { name: string } | null; place_original: string | null }>;
  citations: number;
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const id = params.personId;
  const { result, setCookie } = await withDirectus(request, async (get) => {
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
  });
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", ...(setCookie ? { "Set-Cookie": setCookie } : {}) },
  });
}
