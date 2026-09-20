import type { Config } from "@react-router/dev/config";

export default {
  // Server-rendered on purpose. The Directus token lives in an httpOnly
  // cookie and is read only by loaders, so no script on the page can
  // reach it — which matters more here than usual, because that token
  // can read every living relative in every tree the member belongs to.
  ssr: true,
} satisfies Config;
