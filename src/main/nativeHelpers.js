const fs = require("fs");
const path = require("path");

// Installiert liegen die Helper in resources/native (extraResources von electron-builder).
// In der Entwicklung kommen sie aus native/dist, das `npm run build:native` erzeugt.
// Außerhalb von Electron ist process.resourcesPath nicht gesetzt, dann gilt immer der Entwicklungspfad.
function nativeDirectory() {
  const installed = process.resourcesPath ? path.join(process.resourcesPath, "native") : null;
  if (installed && fs.existsSync(installed)) return installed;
  return path.join(__dirname, "..", "..", "native", "dist");
}

function helperPath(name) {
  return path.join(nativeDirectory(), `${name}.exe`);
}

module.exports = { helperPath };
