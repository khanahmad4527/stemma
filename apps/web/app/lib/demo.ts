/**
 * The one demo flag the browser is allowed to see.
 *
 * `demo.server.ts` holds the snapshot loading and never reaches the
 * client; this holds the single boolean the UI needs, because Vite
 * inlines `VITE_`-prefixed variables into the client bundle. It exists so
 * the static build can hide the parts of the chrome that imply a session
 * there is no server to hold.
 */
export const IS_DEMO = import.meta.env["VITE_DEMO"] === "1";
