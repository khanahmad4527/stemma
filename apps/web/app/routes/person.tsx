import type { Route } from "./+types/person";
import { withDirectus } from "~/lib/directus.server";
import { loadPerson } from "~/lib/queries.server";
import { DEMO, snapshot } from "~/lib/demo.server";

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
  if (DEMO) {
    const frozen = (await snapshot()).person[id];
    if (!frozen) throw new Response("Not found", { status: 404 });
    return new Response(JSON.stringify(frozen), { headers: { "content-type": "application/json" } });
  }
  const { result, setCookie } = await withDirectus(request, (get) => loadPerson(get, id));
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", ...(setCookie ? { "Set-Cookie": setCookie } : {}) },
  });
}
