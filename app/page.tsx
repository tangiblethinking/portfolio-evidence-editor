import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { REQUIRED_ENV, missingConfig } from "../lib/config.ts";
import { getSession } from "../lib/session.ts";
export const dynamic = "force-dynamic";

const MSG: Record<string, string> = { failed: "Incorrect password.", locked: "Too many attempts. Try again in 15 minutes." };

export default async function Page({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const missing = missingConfig();
  if (missing.length) {
    return (
      <main className="login">
        <h1>Editor not configured</h1>
        <p className="muted">Sign-in and all data access are disabled until these server settings exist (names only):</p>
        <p><code>{REQUIRED_ENV.join(", ")}</code></p>
        <p className="muted">Missing or invalid: {missing.join(", ")}</p>
      </main>
    );
  }
  const h = await headers();
  const session = getSession(new Request("https://editor.local/", { headers: { cookie: h.get("cookie") || "" } }));
  const { auth } = await searchParams;
  if (!session) {
    return (
      <main className="login">
        <h1>Portfolio evidence editor</h1>
        <p className="muted">Private editor for the portfolio master collection.</p>
        {auth && MSG[auth] && <p className="err">{MSG[auth]}</p>}
        <form method="post" action="/api/auth/login" style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <input type="password" name="password" aria-label="Password" autoComplete="current-password" required autoFocus />
          <button className="btn primary" type="submit">Sign in</button>
        </form>
      </main>
    );
  }
  redirect("/map");
}
