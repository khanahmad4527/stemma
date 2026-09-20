/**
 * `GET /gedcom/:slug` — a tree as a GEDCOM 7 file.
 *
 * ── Why an endpoint, and why it reads through Directus ─────────────────
 *
 * Everything is fetched with `ItemsService` carrying `req.accountability`,
 * which means the caller's own permissions decide what lands in the file.
 * That is not a convenience; it is the whole security design. The
 * alternative — querying Postgres directly and filtering in this file —
 * would put a second, hand-written copy of the privacy boundary in an
 * export, and the first time the two disagreed it would be a living
 * person's birth date in a file somebody emailed.
 *
 * So there is no privacy logic here at all. A member gets their tree. An
 * anonymous caller gets whatever the public policy grants, which is the
 * dead of a public tree and nothing that names anybody living. The same
 * 19 permissions `verify.ts` proves in both directions are the ones that
 * shape this file.
 *
 * ── Why `readByQuery` per collection rather than one deep read ─────────
 *
 * A single deep query with nested fields would be fewer round trips and
 * would also apply the permission filter at every level, silently
 * dropping a parent whose row the caller cannot see and leaving an edge
 * pointing at nothing. Reading each collection flat means the serialiser
 * sees exactly the rows the caller may have, and can be honest about the
 * gaps rather than emitting a dangling pointer.
 */
import type { Request, Response } from "express";
import { toGedcom, type Data, type Row } from "./gedcom.js";

type Ctx = {
  services: { ItemsService: new (collection: string, options: unknown) => { readByQuery: (q: unknown) => Promise<Row[]> } };
  getSchema: () => Promise<unknown>;
  logger: { error: (message: string) => void };
};

type Router = {
  get: (path: string, handler: (req: Request, res: Response) => Promise<void>) => void;
};

export default {
  id: "gedcom",
  handler: (router: Router, { services, getSchema, logger }: Ctx): void => {
    router.get("/:slug", async (req: Request, res: Response): Promise<void> => {
      const slug = String(req.params["slug"] ?? "");
      try {
        const schema = await getSchema();
        const accountability = (req as Request & { accountability?: unknown }).accountability ?? null;
        const read = async (collection: string, query: Record<string, unknown>): Promise<Row[]> => {
          const service = new services.ItemsService(collection, { schema, accountability });
          return service.readByQuery({ limit: -1, ...query });
        };

        const trees = await read("trees", { filter: { slug: { _eq: slug } }, limit: 1 });
        const tree = trees[0];
        if (!tree) {
          // Deliberately the same answer for "no such tree" and "not
          // yours". A 403 here would confirm that a private tree with
          // that slug exists, which is the sort of thing you can walk a
          // dictionary through.
          res.status(404).json({ errors: [{ message: `No tree "${slug}" you can read.` }] });
          return;
        }
        const inTree = { filter: { tree: { _eq: tree["id"] } } };

        const data: Data = {
          tree,
          persons: await read("persons", { ...inTree, fields: ["*"] }),
          names: await read("person_names", { ...inTree, fields: ["*"] }),
          parentage: await read("parentage", { ...inTree, fields: ["*"] }),
          couples: await read("couples", { ...inTree, fields: ["*"] }),
          events: await read("events", { ...inTree, fields: ["*", "type.code", "type.label", "place.name", "place.id"] }),
          places: await read("places", { ...inTree, fields: ["id", "name"] }),
          sources: await read("sources", { ...inTree, fields: ["*"] }),
          repositories: await read("repositories", { ...inTree, fields: ["*"] }),
          citations: await read("citations", { ...inTree, fields: ["*"] }),
          citationLinks: await read("citation_links", { ...inTree, fields: ["*"] }),
          generatedAt: new Date(),
        };

        const body = toGedcom(data);
        // The media type GEDCOM 7 registered. The disposition is what
        // actually makes a browser save it rather than render it.
        res.setHeader("Content-Type", "text/vnd.familysearch.gedcom; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${slug}.ged"`);
        res.send(body);
      } catch (error) {
        logger.error(`gedcom export of "${slug}": ${String(error)}`);
        res.status(500).json({ errors: [{ message: "The export failed." }] });
      }
    });
  },
};
