import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { DirectusError, signIn, sessionFrom } from "~/lib/directus.server";
import { readSession } from "~/lib/session.server";

export function meta() {
  return [{ title: "Sign in · Stemma" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await readSession(request);
  if (session.get("access_token")) throw redirect("/");
  return { demo: process.env.NODE_ENV !== "production" };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/") || "/";
  if (!email || !password) return { error: "Enter an email address and a password." };

  try {
    const data = await signIn(email, password);
    return redirect(next.startsWith("/") ? next : "/", {
      headers: { "Set-Cookie": await sessionFrom(data, request) },
    });
  } catch (e) {
    if (e instanceof DirectusError) {
      return { error: e.status === 401 ? "That email and password do not match an account." : e.message };
    }
    // Directus down is a different problem from a wrong password, and
    // telling somebody their password is wrong when the server is
    // unreachable sends them to reset a password that was fine.
    return { error: "Could not reach the archive. Is Directus running?" };
  }
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  return (
    <main className="signin">
      <Form method="post">
        <div>
          <h1>Stemma</h1>
          <p className="lede">Sign in to open the family trees you belong to.</p>
        </div>
        {actionData?.error && <div className="err" role="alert">{actionData.error}</div>}
        <input type="hidden" name="next" value={params.get("next") ?? "/"} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {loaderData.demo && (
          <p className="hint">
            Demo: <code>owner@stemma.example.com</code> · <code>cousin@stemma.example.com</code>
            <br />password <code>StemmaDemo!2026</code>
          </p>
        )}
      </Form>
    </main>
  );
}
