import { TARGET } from "../../../../lib/config.ts";
import { getDirFileBytes } from "../../../../lib/github.ts";
import { authorize, json } from "../../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NAME = /^[a-z0-9][a-z0-9._-]{0,150}\.webp$/;
/** Thumbnails referenced by the original map as src/images/<file>.webp, read from the fixed images directory. Signed-in only. */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const a = authorize(req);
  if ("error" in a) return a.error;
  const { file } = await ctx.params;
  if (!NAME.test(file) || file.includes("..")) return json(404, { error: "not_found" });
  try {
    const b = await getDirFileBytes(TARGET.imagesDir, file);
    if (!b) return json(404, { error: "not_found" });
    return new Response(new Uint8Array(b), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=3600" } });
  } catch {
    return json(502, { error: "github" });
  }
}
