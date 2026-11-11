import { headers } from "next/headers";
import Editor from "../components/Editor.tsx";
import { ALLOWED_LOGINS, REQUIRED_ENV, missingConfig } from "../lib/config.ts";
import { getSession } from "../lib/session.ts";
export const dynamic = "force-dynamic";

const MSG: Record<string, string> = { state: "Sign-in expired or was tampered with. Try again.", failed: "GitHub sign-in failed.", forbidden: "That GitHub account is not allowed to use this editor." };

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
        <p className="muted">Private editor for the portfolio master collection. Sign in with GitHub ({ALLOWED_LOGINS.join(", ")} only).</p>
        {auth && MSG[auth] && <p className="err">{MSG[auth]}</p>}
        <p><a className="btn primary" href="/api/auth/login">Sign in with GitHub</a></p>
      </main>
    );
  }
  return <Editor login={session.login} csrf={session.csrf} />;
}
