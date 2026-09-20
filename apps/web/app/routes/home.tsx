import { Form, Link } from "react-router";
import type { Route } from "./+types/home";
import { withDirectus } from "~/lib/directus.server";
import { ThemePicker } from "~/components/Theme";

export function meta() {
  return [{ title: "Your trees · Stemma" }];
}

type TreeRow = { id: string; name: string; slug: string; is_public: boolean };
type Me = { first_name: string | null; last_name: string | null; email: string };

export async function loader({ request }: Route.LoaderArgs) {
  const { result, setCookie } = await withDirectus(request, async (get) => {
    // The member policy's filter does the work: this asks for every tree
    // and Directus returns only the ones they belong to.
    const [trees, me] = await Promise.all([
      get<TreeRow[]>("/items/trees?limit=-1&fields=id,name,slug,is_public&sort=name"),
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
  });
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
        <span className="who">{who}</span>
        <Form method="post" action="/logout"><button className="btn quiet" type="submit">Sign out</button></Form>
      </header>
      <main className="picker">
        <h1>Your trees</h1>
        <p className="lede">
          {trees.length === 1 ? "One tree" : `${trees.length} trees`} you are a member of.
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
