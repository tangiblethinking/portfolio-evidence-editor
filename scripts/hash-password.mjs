// Prints an EDITOR_PASSWORD_HASH for a password read from stdin (not echoed, never stored).
//   node scripts/hash-password.mjs            (prompts; input hidden on a TTY)
//   printf %s "$PASSWORD" | node scripts/hash-password.mjs
// Output format: scrypt$N$r$p$<salt base64url>$<key base64url>. The hash is not the password, but keep it private.
import crypto from "node:crypto";
const N = 32768, r = 8, p = 1;
async function readPassword() {
  if (!process.stdin.isTTY) { let s = ""; for await (const c of process.stdin) s += c; return s.replace(/\r?\n$/, ""); }
  process.stderr.write("Password: ");
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return new Promise((res) => { let s = ""; process.stdin.on("data", (ch) => { if (ch === "\r" || ch === "\n") { process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write("\n"); res(s); } else if (ch === "\u0003") process.exit(1); else if (ch === "\u007f") s = s.slice(0, -1); else s += ch; }); });
}
const pw = await readPassword();
if (pw.length < 12) { console.error("Use at least 12 characters."); process.exit(1); }
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(pw, salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}\n`);
