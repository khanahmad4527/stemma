import {
  isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError,
} from "react-router";
import type { LinksFunction } from "react-router";
import { NO_FLASH } from "~/components/Theme";
import "./app.css";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    // Spectral for names and dates — a text serif with old-style
    // numerals, which matters in an interface that is four-fifths years.
    // Inter for chrome.
    href: "https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600&family=Inter:wght@400;500;600&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        {/* A private family record: never indexed, whatever else happens. */}
        <meta name="robots" content="noindex, nofollow" />
        <Meta />
        <Links />
        {/* Applies the saved theme before first paint. Without it every
            load shows parchment for a frame before the tapestry. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="centred">
      <div>
        <h1>{is404 ? "Not here" : "Something went wrong"}</h1>
        <p style={{ color: "var(--ink-faint)", maxWidth: 420 }}>
          {is404
            ? "That tree does not exist, or you are not a member of it. Those look the same from outside on purpose."
            : isRouteErrorResponse(error)
              ? error.statusText || String(error.status)
              : "An unexpected error occurred."}
        </p>
        <p><a className="btn" href="/">Back to your trees</a></p>
      </div>
    </main>
  );
}
