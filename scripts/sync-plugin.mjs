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
const checkOnly = process.argv.includes("--check");

const sourceContent = await readFile(source);
const sourceText = sourceContent.toString("utf8");

const versionMatch = sourceText.match(/PLUGIN_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) {
  console.error("[LUA-X] Could not find PLUGIN_VERSION in the canonical plugin source.");
  process.exit(1);
}
const version = versionMatch[1];
const sha256 = createHash("sha256").update(sourceContent).digest("hex");

if (checkOnly) {
  let stale = false;
  for (const target of targets) {
    let targetContent;
    try {
      targetContent = await readFile(target);
    } catch {
      stale = true;
      console.error(`[LUA-X] Missing synced copy: ${target}`);
      continue;
    }
    if (!targetContent.equals(sourceContent)) {
      stale = true;
      console.error(`[LUA-X] Stale synced copy: ${target}`);
    }
  }
  let manifestText;
  try {
    manifestText = await readFile(manifest, "utf8");
  } catch {
    stale = true;
    console.error(`[LUA-X] Missing manifest: ${manifest}`);
    manifestText = "";
  }
  const expectedManifest = JSON.stringify({
    name: "LUA-X Studio Plugin",
    filename: "LUA-X.lua",
    version,
    source: "studio-plugin/LUA-X-connected.lua",
    sha256,
    minimumStudioVersion: "2024",
    requiredVersion: version,
  }, null, 2) + "\n";
  if (manifestText !== expectedManifest) {
    stale = true;
    console.error(`[LUA-X] Stale manifest: ${manifest}`);
  }
  if (stale) {
    console.error("[LUA-X] Plugin sync drift detected. Run `npm run sync:plugin` and commit the result.");
    process.exit(1);
  }
  console.log(`[LUA-X] Plugin v${version} copies and manifest are in sync (sha256=${sha256.slice(0, 12)}…).`);
  process.exit(0);
}

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
    version,
    source: "studio-plugin/LUA-X-connected.lua",
    sha256,
    minimumStudioVersion: "2024",
    requiredVersion: version,
  }, null, 2) + "\n",
  "utf8",
);

console.log(`[LUA-X] Canonical connected Studio plugin v${version} synchronized (sha256=${sha256.slice(0, 12)}…).`);