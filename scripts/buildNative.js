const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const output = path.join(root, "native", "dist");
const helpers = ["keyboard", "touchpad", "touchpad-settings-refresh", "windows-automation"];

// Alle vier Helper landen im selben Ordner. Die self-contained Runtime-Dateien sind identisch
// und werden dadurch nur einmal abgelegt, sonst wäre jeder Helper über 150 MB groß.
fs.rmSync(output, { recursive: true, force: true });

for (const helper of helpers) {
  const args = [
    "publish", path.join(root, "native", helper),
    "-c", "Release",
    "-r", "win-x64",
    "--self-contained", "true",
    "-p:DebugType=none",
    "-p:DebugSymbols=false",
    "-o", output,
  ];
  const result = spawnSync("dotnet", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
