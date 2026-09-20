import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route(":slug", "routes/tree.tsx"),
  // A resource route, not a page: the panel fetches one person's detail
  // through the server so the Directus token stays in the httpOnly
  // cookie. Loading every event for every person up front would be a
  // megabyte of payload to show one panel.
  route(":slug/p/:personId", "routes/person.tsx"),
  // Portraits come through the server because the Directus token is in
  // an httpOnly cookie the browser cannot read.
  route("portrait/:fileId", "routes/portrait.tsx"),
] satisfies RouteConfig;
