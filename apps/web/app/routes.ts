import { type RouteConfig, index, route } from "@react-router/dev/routes";

/**
 * The static demo has no server to hold a session and no Directus to ask,
 * so it has no sign-in, no sign-out and no portrait proxy — the portraits
 * are flat files beside the HTML. Leaving those routes in a client-only
 * build would ship three modules whose whole job is to read a cookie
 * nothing sets.
 */
const demo = process.env["VITE_DEMO"] === "1";

export default [
  index("routes/home.tsx"),
  ...(demo ? [] : [
    route("login", "routes/login.tsx"),
    route("logout", "routes/logout.tsx"),
  ]),
  route(":slug", "routes/tree.tsx"),
  // A resource route, not a page: the panel fetches one person's detail
  // through the server so the Directus token stays in the httpOnly
  // cookie. Loading every event for every person up front would be a
  // megabyte of payload to show one panel.
  route(":slug/p/:personId", "routes/person.tsx"),
  // Portraits come through the server because the Directus token is in
  // an httpOnly cookie the browser cannot read.
  ...(demo ? [] : [route("portrait/:fileId", "routes/portrait.tsx")]),
] satisfies RouteConfig;
