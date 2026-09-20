import type { Route } from "./+types/portrait";
import { DIRECTUS_URL } from "~/lib/directus.server";
import { requireSession } from "~/lib/session.server";

/**
 * A portrait, fetched on the member's behalf.
 *
 * `/assets/<id>` on Directus answers on `directus_files`' own
 * permissions, and the token that satisfies them lives in an httpOnly
 * cookie the browser cannot read. So the image cannot be an ordinary
 * `<img src>` pointing at Directus — it comes through here, where the
 * server has the cookie.
 *
 * That is also the safer arrangement. Directus still decides: a file is
 * only served if the signed-in member may read it, and a 403 comes back
 * as a 404 so this route cannot be used to probe which file ids exist.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await requireSession(request);
  const id = params.fileId;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Response("Not found", { status: 404 });

  const res = await fetch(`${DIRECTUS_URL}/assets/${id}?width=256&height=256&fit=cover&format=webp`, {
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok || !res.body) throw new Response("Not found", { status: 404 });

  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/webp",
      // Private: this is somebody's family photograph, and a shared
      // cache must never hand it to the next person who asks.
      "cache-control": "private, max-age=3600",
    },
  });
}
