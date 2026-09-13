import { createRequire } from "node:module";
import { readFile, realpath, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const game = path.resolve(root, "../game");
const require = createRequire(path.join(game, "package.json"));
const fromGame = (name) => import(pathToFileURL(require.resolve(name)).href);
const { build } = await fromGame("vite");
const { default: react } = await fromGame("@vitejs/plugin-react");
const { default: tailwind } = await fromGame("@tailwindcss/postcss");
const outDir = path.join(root, "app/src/main/assets/game");
await mkdir(outDir, { recursive: true });
// Vite clears only its generated assets. Reject a symlink/junction outside this project.
const resolvedRoot = await realpath(root);
const resolvedOutput = await realpath(outDir);
if (resolvedOutput !== path.join(resolvedRoot, "app/src/main/assets/game")) {
  throw new Error("Refusing to clear an output directory outside android-app assets.");
}

await build({
  configFile: false,
  root: path.join(root, "web"),
  base: "./",
  publicDir: false,
  plugins: [
    {
      name: "offline-fonts",
      enforce: "pre",
      async load(id) {
        if (id.replaceAll("\\", "/").endsWith("/game/app/globals.css")) {
          return (await readFile(id, "utf8")).replace(/@import\s+url\([^)]*\)\s*;\s*/g, "");
        }
      },
    },
    react(),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: game },
      { find: /^react-dom(\/.*)?$/, replacement: path.join(game, "node_modules/react-dom") + "$1" },
      { find: /^react(\/.*)?$/, replacement: path.join(game, "node_modules/react") + "$1" },
    ],
    dedupe: ["react", "react-dom"],
  },
  css: { postcss: { plugins: [tailwind({ base: game })] } },
  build: { outDir, emptyOutDir: true, target: "chrome111", sourcemap: false },
});
console.log("Offline Android game ready:", outDir);
