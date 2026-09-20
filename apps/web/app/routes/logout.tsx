import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { readSession, sessionStorage } from "~/lib/session.server";
import { DIRECTUS_URL } from "~/lib/directus.server";

/**
 * Sign out at both ends.
 *
 * Dropping the cookie is enough for this browser; telling Directus to
 * revoke the refresh token is what stops a copied token being useful
 * afterwards. A failure to reach Directus must not leave the person
 * signed in here, so the revocation is best-effort and the cookie goes
 * either way.
 */
export async function action({ request }: Route.ActionArgs) {
  const session = await readSession(request);
  const refresh = session.get("refresh_token") as string | undefined;
  if (refresh) {
    await fetch(`${DIRECTUS_URL}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh, mode: "json" }),
    }).catch(() => {});
  }
  return redirect("/login", { headers: { "Set-Cookie": await sessionStorage.destroySession(session) } });
}

export async function loader() {
  return redirect("/");
}
