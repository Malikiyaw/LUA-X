import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const source = resolve(root, "studio-plugin", "LUA-X-connected.lua");
const targets = [
  resolve(root, "apps", "web", "public", "LUA-X.lua"),
  resolve(root, "apps", "web", "public", "download", "LUA-X.lua"),
];
const manifest = resolve(root, "apps", "web", "public", "download", "plugin-manifest.json");

const sourceContent = await readFile(source);
const sha256 = createHash("sha256").update(sourceContent).digest("hex");

for (const target of targets) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

await mkdir(dirname(manifest), { recursive: true });
await writeFile(
  manifest,
  JSON.stringify({
    name: "LUA-X Studio Plugin",
    filename: "LUA-X.lua",
    version: "1.1.0",
    source: "studio-plugin/LUA-X-connected.lua",
    sha256,
  }, null, 2) + "\n",
  "utf8",
);

console.log(`[LUA-X] Canonical connected Studio plugin synchronized (sha256=${sha256.slice(0, 12)}…).`);
