import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the repository starts.
 *
 * `.env` and `directus/` live at the root, and reaching them by counting
 * directories — `join(__dirname, "..", "..")` — is correct exactly until
 * somebody moves the package. Walking up for the workspace marker is a
 * few lines and survives the move. `pnpm-workspace.yaml` exists only at
 * the root, by definition.
 */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 10; up++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("cannot find the repository root — no pnpm-workspace.yaml above this package");
}

export const REPO_ROOT = findRoot();
export const fromRoot = (...parts: string[]): string => join(REPO_ROOT, ...parts);
