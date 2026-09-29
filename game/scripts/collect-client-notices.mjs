import { readFile, writeFile } from "node:fs/promises";

// These libraries are included in both the browser and offline Android JS bundle.
const packages = ["react", "react-dom", "scheduler"];
const notices = await Promise.all(
  packages.map(async (name) => {
    const directory = new URL(`../node_modules/${name}/`, import.meta.url);
    const pkg = JSON.parse(
      await readFile(new URL("package.json", directory), "utf8"),
    );
    const license = await readFile(new URL("LICENSE", directory), "utf8");
    return { name, version: pkg.version, license };
  }),
);
notices.push({
  name: "Pretendard",
  version: "1.3.9",
  license: await readFile(new URL("../app/fonts/OFL.txt", import.meta.url), "utf8"),
});
await writeFile(
  new URL("../lib/client-notices.json", import.meta.url),
  JSON.stringify(notices, null, 2) + "\n",
);
console.log(`Collected notices for ${notices.length} client libraries.`);
