// Bundles the site into one self-contained HTML file (dist/livekanji.html)
// so it can be shared as a single page. Usage: node scripts/build-preview.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const html = read("index.html");

const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const css = read("css/styles.css");
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => `<script>\n${read(m[1])}\n</script>`).join("\n");

const out = `<title>LiveKanji</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
<div id="app"></div>
${scripts}
`;
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/livekanji.html"), out);
console.log("Wrote dist/livekanji.html (" + out.length + " chars)");
