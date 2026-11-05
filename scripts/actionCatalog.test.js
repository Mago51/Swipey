const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { actionRegistry } = require("../src/main/actionRegistry.js");

const root = path.join(__dirname, "..");
const commandFiles = [
  ["apps", "appCommands", "src/commands/apps.js"],
  ["web", "webCommands", "src/commands/web.js"],
  ["events", "eventCommands", "src/commands/events.js"],
  ["pc", "pcCommands", "src/commands/pc.js"],
];
const categories = [
  { id: "apps", type: "app" },
  { id: "web", type: "web" },
  { id: "events", type: "event" },
  { id: "pc", type: "pc" },
];

function loadArray(exportName, relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const cjs = source.replace(`export const ${exportName} =`, "module.exports =");
  const context = { module: { exports: null }, exports: {} };
  vm.runInNewContext(cjs, context, { filename: relativePath });
  return context.module.exports;
}

function allCommands() {
  return commandFiles.flatMap(([categoryId, exportName, file]) =>
    loadArray(exportName, file).map((command) => ({ categoryId, ...command }))
  );
}

function testCatalogShape() {
  const commands = allCommands();
  const ids = commands.map((command) => command.id);
  assert.strictEqual(new Set(ids).size, ids.length, "action ids must be unique");
  assert.deepStrictEqual(commandFiles.map(([id]) => id), categories.map((category) => category.id), "four command categories must remain stable");

  for (const command of commands) {
    assert.ok(command.description, `${command.id} must describe the action`);
    assert.deepStrictEqual(command.categoryId, categories.find((category) => command.type === category.type)?.id, `${command.id} category type must match`);
  }
}

function testHandlersMatchCatalog() {
  for (const command of allCommands()) {
    const handler = actionRegistry[command.id];
    assert.ok(handler, `${command.id} must have an explicit main-process registry entry`);
    if (command.nodeKind) {
      assert.strictEqual(handler.executable, false, `${command.id} logic nodes run through the Flow node executor, not as standalone actions`);
    } else {
      assert.notStrictEqual(handler.executable, false, `${command.id} must be executable`);
      assert.strictEqual(typeof handler.execute, "function", `${command.id} must have a handler`);
    }
  }
}

function testBatchActionImplementationContracts() {
  const commands = new Map(allCommands().map((command) => [command.id, command]));
  const expected = [
    "app.focus", "app.minimize", "app.maximize", "app.moveToPosition", "app.waitUntilOpens",
    "pc.setVolume", "pc.pastePresetText", "pc.keyboardSequence", "web.openInBrowser", "web.openMultiple",
    "event.loop", "event.condition", "event.randomChoice", "event.delayBetweenActions", "event.runAfterDelay",
    "event.waitUntil", "app.ifRunning", "app.ifNotRunning", "event.setVariable", "event.incrementVariable",
    "event.decrementVariable", "event.try", "event.continueOnError", "event.stopWithError",
  ];
  for (const id of expected) {
    const command = commands.get(id);
    assert.ok(command, `${id} must exist in the catalog`);
    if (!command.nodeKind) assert.notStrictEqual(actionRegistry[id].executable, false, `${id} should have an executable handler`);
  }
}

function testLegacyIdsPointAtCatalog() {
  const source = fs.readFileSync(path.join(root, "src/commands/catalog.js"), "utf8");
  const legacyBody = source.match(/export const legacyCommandIds = \{([\s\S]*?)\};/);
  assert.ok(legacyBody, "legacy id map must exist");
  const legacyIds = vm.runInNewContext(`({${legacyBody[1]}})`);
  const ids = new Set(allCommands().map((command) => command.id));
  for (const [legacyId, modernId] of Object.entries(legacyIds)) {
    assert.ok(ids.has(modernId), `${legacyId} must resolve to an existing action id`);
  }
}

function testUiBadgeAndCategoryContracts() {
  const renderer = fs.readFileSync(path.join(root, "src/app/renderer.js"), "utf8");
  const commandCss = fs.readFileSync(path.join(root, "Styles/command-library.css"), "utf8");
  assert.match(renderer, /app\.moveToPosition/, "Move App to Position should have a parameter editor");
  assert.match(renderer, /app\.waitUntilOpens/, "Wait Until App Opens should have a parameter editor");
  assert.match(renderer, /web\.openInBrowser/, "Open Website in Browser should have a parameter editor");
  assert.match(renderer, /web\.openMultiple/, "Open Multiple Websites should have a parameter editor");
  assert.match(renderer, /pc\.setVolume/, "Set Volume should have a parameter editor");
  assert.match(renderer, /pc\.pastePresetText/, "Paste Preset Text should have a parameter editor");
  assert.match(renderer, /pc\.keyboardSequence/, "Keyboard Sequence should have a parameter editor");
  assert.match(renderer, /logic-container/, "logic nodes should render as container blocks");
  assert.match(renderer, /logic-slot/, "logic containers should render child drop/add areas");
  assert.match(renderer, /nested-add-select/, "logic containers should support click-to-add nested actions");
  assert.match(renderer, /add-random-branch/, "Random Choice should support adding options");
  assert.match(renderer, /event\.setVariable/, "Set Variable should have a parameter editor");
  assert.match(renderer, /event\.incrementVariable/, "Increment Variable should have a parameter editor");
  assert.match(renderer, /event\.stopWithError/, "Stop Flow with Error should have a parameter editor");
  assert.match(renderer, /"try"[\s\S]*?"onError"|"onError"[\s\S]*?"TRY"|renderNodeSlot\(node, "onError"/, "Try nodes should render an ON ERROR slot");
  assert.match(renderer, /variable-insert-select/, "templatable text fields should offer a variable insert control");
  assert.match(renderer, /conditionFamily/, "the If\\/Wait Until condition editor should support switching between App, Variable, and Execution Result");
  assert.match(commandCss, /\.category-card\s*\{[\s\S]*border-radius:\s*var\(--radius-md\)/, "category cards should remain real card controls");
  assert.match(commandCss, /\.library-command\s*\{[\s\S]*min-height:\s*50px\s*;/, "command rows must reserve two-line row height");
  assert.doesNotMatch(commandCss, /\.library-command\s*\{[\s\S]*min-height:\s*0\s*;/, "command rows must not collapse to zero min-height");
  assert.match(commandCss, /\.library-command-name,\s*\.library-command-description\s*\{[\s\S]*white-space:\s*nowrap\s*;/, "command text must stay on one line with ellipsis");
}

testCatalogShape();
testHandlersMatchCatalog();
testBatchActionImplementationContracts();
testLegacyIdsPointAtCatalog();
testUiBadgeAndCategoryContracts();

console.log("action catalog tests passed");
