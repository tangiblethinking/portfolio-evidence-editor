// The original evidence map page (data/source/evidence-map/index.html in the portfolio repo), served unchanged except
// for one injected block before </body>: the session's CSRF token and the editor overlay (lib/map-overlay.js), which
// adds the per-record Indexable toggles and Save. Source facts in the page are not rewritten.
import fs from "node:fs";
import path from "node:path";
let overlay: string | null = null;
export function overlayScript(): string {
  if (overlay === null) overlay = fs.readFileSync(path.join(process.cwd(), "lib/map-overlay.js"), "utf8");
  return overlay;
}
export function injectOverlay(html: string, csrf: string): string {
  const at = html.lastIndexOf("</body>");
  if (at < 0) throw new Error("evidence map has no </body>");
  const cfg = JSON.stringify({ csrf }).replace(/</g, "\\u003c");
  const block = `<script type="application/json" id="editor-config">${cfg}</script>\n<script>\n${overlayScript()}</script>\n`;
  return html.slice(0, at) + block + html.slice(at);
}
