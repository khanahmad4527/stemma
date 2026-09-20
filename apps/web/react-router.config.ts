import type { Config } from "@react-router/dev/config";
import { readFileSync } from "node:fs";

/**
 * Two builds out of one app.
 *
 * **The real one** is server-rendered on purpose. The Directus token
 * lives in an httpOnly cookie and is read only by loaders, so no script
 * on the page can reach it — which matters more here than usual, because
 * that token can read every living relative in every tree the member
 * belongs to.
 *
 * **The static showcase** (`VITE_DEMO=1`, via `pnpm demo:build`) turns
 * the same app into flat files. The loaders run once, here, against the
 * snapshot in `demo-data/`, and what ships is HTML and `.data` — no
 * server, no database, no sign-in, nothing to keep alive. It is the same
 * components and the same layouts; only the data source differs.
 *
 * Every person is prerendered because the side panel fetches
 * `/:slug/p/:id` as a resource route. A hundred and forty-seven small
 * JSON files is a rounding error beside the portraits, and it means the
 * panel works with no runtime at all.
 */
const demo = process.env["VITE_DEMO"] === "1";

type Snapshot = { tree: Record<string, { data: { persons: Array<{ id: string }> } }> };

export default (demo
  ? {
      ssr: false,
      // Its own directory, because the two builds would otherwise write
      // the same `build/client` and the last one to run would win. That
      // is not hypothetical: a verification run of the normal build
      // silently replaced the prerendered HTML, and the first deploy put
      // up 29 files instead of 329 and answered 404 for every page.
      buildDirectory: "build-demo",
      prerender(): string[] {
        const snapshot = JSON.parse(readFileSync("demo-data/snapshot.json", "utf8")) as Snapshot;
        const paths = ["/"];
        for (const [slug, one] of Object.entries(snapshot.tree)) {
          paths.push(`/${slug}`);
          for (const p of one.data.persons) paths.push(`/${slug}/p/${p.id}`);
        }
        return paths;
      },
    }
  : { ssr: true }) satisfies Config;
