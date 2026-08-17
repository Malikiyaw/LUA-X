import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const source = resolve(root, "studio-plugin", "LUA-X.plugin.lua");
const targets = [
  resolve(root, "apps", "web", "public", "LUA-X.lua"),
  resolve(root, "apps", "web", "public", "download", "LUA-X.lua"),
];

for (const target of targets) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

console.log("[LUA-X] Synchronized canonical Studio plugin into web download assets.");
