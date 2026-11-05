const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { validateFlow } = require("../src/main/flowValidator.js");

const root = path.join(__dirname, "..");

function loadCatalogFindCommand() {
  // catalog.js ist ein ES-Modul und importiert die vier Command-Dateien. Wir laden sie so
  // wie in actionCatalog.test.js und bauen findCommand() und die Command-Liste nach.
  const commandFiles = [
    ["apps", "appCommands", "src/commands/apps.js"],
    ["web", "webCommands", "src/commands/web.js"],
    ["events", "eventCommands", "src/commands/events.js"],
    ["pc", "pcCommands", "src/commands/pc.js"],
  ];
  const categories = [
    { id: "apps", label: "Apps", type: "app" },
    { id: "web", label: "Web", type: "web" },
    { id: "events", label: "Events", type: "event" },
    { id: "pc", label: "PC", type: "pc" },
  ];
  function loadArray(exportName, relativePath) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8").replace(`export const ${exportName} =`, "module.exports =");
    const context = { module: { exports: null }, exports: {} };
    vm.runInNewContext(source, context, { filename: relativePath });
    return context.module.exports;
  }
  const commands = commandFiles.flatMap(([categoryId, exportName, file]) => {
    const category = categories.find((item) => item.id === categoryId);
    return loadArray(exportName, file).map((command) => ({ ...command, categoryId, categoryLabel: category.label }));
  });
  return (commandId) => commands.find((command) => command.id === commandId);
}

function loadFlowTemplatesWithRealFindCommand() {
  const findCommand = loadCatalogFindCommand();
  const source = fs
    .readFileSync(path.join(root, "src/commands/flowTemplates.js"), "utf8")
    .replace('import { findCommand } from "./catalog.js";', "")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ");
  return vm.runInNewContext(
    `${source}\n({ flowTemplates, templateActionLabels, findTemplate })`,
    { findCommand },
    { filename: "flowTemplates.js" }
  );
}

function testTemplateIdsAreUniqueAndWellFormed() {
  const { flowTemplates } = loadFlowTemplatesWithRealFindCommand();
  assert.ok(Array.isArray(flowTemplates) && flowTemplates.length >= 10, "there should be at least 10 V1 templates");
  const ids = flowTemplates.map((template) => template.id);
  assert.strictEqual(new Set(ids).size, ids.length, "template ids must be unique");
  for (const template of flowTemplates) {
    assert.ok(template.name, `${template.id} must have a name`);
    assert.ok(template.description, `${template.id} must have a description`);
    assert.ok(template.category, `${template.id} must have a category`);
    assert.ok(Array.isArray(template.flow?.actions) && template.flow.actions.length > 0, `${template.id} must define at least one action`);
  }
}

function testEveryTemplateFlowValidatesAndOnlyUsesRealActions() {
  // Templates haben bewusst keine Action-IDs. Die vergibt normalizeFlow erst, wenn ein
  // Template benutzt wird. Hier setzen wir Dummy-IDs ein, damit die Validierung dieselbe
  // Form sieht, ohne die ID-Vergabe nachzubauen.
  const { flowTemplates } = loadFlowTemplatesWithRealFindCommand();
  for (const template of flowTemplates) {
    const actionsWithIds = template.flow.actions.map((action, index) => ({ id: `check-${index}`, ...action }));
    const validation = validateFlow({ id: "template-check", name: template.flow.name, enabled: true, actions: actionsWithIds });
    assert.strictEqual(
      validation.valid,
      true,
      `${template.id} must be a valid Flow (${JSON.stringify(validation.errors)}) - this also proves every action id it references actually exists`
    );
  }
}

function testRendererWiresTemplatePicker() {
  const renderer = fs.readFileSync(path.join(root, "src/app/renderer.js"), "utf8");
  assert.match(renderer, /createDraftFromTemplate/, "using a template must build its draft through the shared flow normalization helper");
  assert.match(renderer, /saveFlowDraft\(createDraftFromTemplate\(template\)\)/, "using a template must be created through the same saveFlowDraft() path as every other Flow");
}

testTemplateIdsAreUniqueAndWellFormed();
testEveryTemplateFlowValidatesAndOnlyUsesRealActions();
testRendererWiresTemplatePicker();

console.log("flow templates tests passed");
