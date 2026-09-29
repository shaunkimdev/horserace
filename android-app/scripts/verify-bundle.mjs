import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../app/src/main/assets/game/", import.meta.url));
const html = await readFile(path.join(root, "index.html"), "utf8");
assert.ok((await stat(path.join(root, "studio-buddy.png"))).size > 0, "The studio mascot must work offline.");
assert.ok((await stat(path.join(root, "fonts/PretendardVariable.ttf"))).size > 0, "Native controls must have the same offline typeface.");
assert.match(await readFile(path.join(root, "fonts/OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE/);
assert.match(html, /connect-src 'none'/, "Offline practice must not call a remote API.");
const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
assert.ok(files.some((file) => file.endsWith(".js")));
assert.ok(files.some((file) => file.endsWith(".css")));
for (const file of files) {
  assert.ok(file.startsWith("./"), "All first-launch resources must be bundled locally.");
  const resolved = path.resolve(root, file);
  assert.ok(resolved.startsWith(root), "Resource escaped the asset directory.");
  assert.ok((await stat(resolved)).size > 0);
  if (file.endsWith(".css")) {
    const css = await readFile(resolved, "utf8");
    assert.doesNotMatch(css, /@import\s|fonts\.googleapis\.com/);
    assert.match(css, /\.race-canvas-wrap/);
    assert.match(css, /\.track-card/);
    assert.match(css, /@font-face/);
    const fontFiles = [...css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map(match => match[1]);
    assert.ok(fontFiles.length > 0, "WebView must bundle the shared font.");
    for (const font of fontFiles) {
      assert.ok(font.startsWith("./"), "Fonts must resolve relative to offline CSS.");
      const fontPath = path.resolve(path.dirname(resolved), font);
      assert.ok(fontPath.startsWith(root), "Font escaped the asset directory.");
      assert.ok((await stat(fontPath)).size > 0);
    }
  }
}
console.log(`Offline bundle verified: ${files.length} local resources, no external fonts or API connection.`);
