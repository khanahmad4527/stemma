import { Form, Link } from "react-router";
import type { Route } from "./+types/home";
import { withDirectus } from "~/lib/directus.server";
import { loadTrees } from "~/lib/queries.server";
import { DEMO, snapshot } from "~/lib/demo.server";
import { ThemePicker } from "~/components/Theme";
import { IS_DEMO } from "~/lib/demo";

export function meta() {
  return [{ title: IS_DEMO ? "Stemma — a demo" : "Your trees · Stemma" }];
}

type TreeRow = { id: string; name: string; slug: string; is_public: boolean };
type Me = { first_name: string | null; last_name: string | null; email: string };

export async function loader({ request }: Route.LoaderArgs) {
  if (DEMO) {
    return new Response(JSON.stringify((await snapshot()).trees), {
      headers: { "content-type": "application/json" },
    });
  }
  const { result, setCookie } = await withDirectus(request, loadTrees);
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", ...(setCookie ? { "Set-Cookie": setCookie } : {}) },
  });
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { trees, me, counts } = loaderData as { trees: TreeRow[]; me: Me; counts: Record<string, number> };
  const who = [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email;
  return (
    <div className="shell">
      <header className="bar">
        <Link className="mark" to="/">Stemma</Link>
        <div className="spacer" />
        <ThemePicker />
        {/* No session to show or end when the data is frozen into the page. */}
        {!IS_DEMO && <span className="who">{who}</span>}
        {!IS_DEMO && (
          <Form method="post" action="/logout"><button className="btn quiet" type="submit">Sign out</button></Form>
        )}
      </header>
      <main className="picker">
        <h1>{IS_DEMO ? "Three families" : "Your trees"}</h1>
        <p className="lede">
          {IS_DEMO
            ? "Invented families, seeded to exercise the awkward cases — pedigree collapse, adoption, four parents, a disproven line. Frozen from a live instance; nothing here is a real person."
            : `${trees.length === 1 ? "One tree" : `${trees.length} trees`} you are a member of.`}
        </p>
        {trees.length === 0 ? (
          <p className="empty">
            You are not a member of any tree yet. An owner has to add you — membership is per tree,
            so being signed in is not by itself access to anything.
          </p>
        ) : (
          <ul>
            {trees.map((t) => (
              <li key={t.id}>
                <Link to={`/${t.slug}`}>
                  <span className="t-name">{t.name}</span>
                  <span className="t-meta">
                    {counts[t.id] ?? 0} {counts[t.id] === 1 ? "person" : "people"}
                    {" · "}{t.is_public ? "public" : "private"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
