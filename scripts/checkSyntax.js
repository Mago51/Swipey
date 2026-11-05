const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const entries = ["main.js", "preload.js", "src", "scripts"];

function collect(target) {
  const full = path.join(root, target);
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return collect(child);
    return entry.name.endsWith(".js") ? [path.join(root, child)] : [];
  });
}

let failed = false;
for (const file of entries.flatMap(collect)) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    console.error(`${path.relative(root, file)}\n${result.stderr}`);
  }
}
process.exit(failed ? 1 : 0);
