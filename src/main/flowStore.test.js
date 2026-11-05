const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const flowStore = require("./flowStore.js");
const { validateFlow } = require("./flowValidator.js");

async function withTempDir(test) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swipey-flows-"));
  try {
    await test(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function newFlow(name) {
  return { name, enabled: true, actions: [{ id: "a1", type: "pc.lock", params: {} }] };
}

async function testFlowCountIsNotLimited() {
  await withTempDir(async (dir) => {
    await flowStore.initializeFlowStore(dir);
    const seeded = flowStore.getFlows().length;
    for (let index = 0; index < 10; index += 1) {
      await flowStore.createFlow(newFlow(`Extra Flow ${index}`));
    }
    assert.strictEqual(flowStore.getFlows().length, seeded + 10, "creating flows must never be limited");
  });
}

async function testDuplicateIsNotLimited() {
  await withTempDir(async (dir) => {
    await flowStore.initializeFlowStore(dir);
    const before = flowStore.getFlows().length;
    const [existing] = flowStore.getFlows();
    await flowStore.duplicateFlow(existing.id);
    assert.strictEqual(flowStore.getFlows().length, before + 1, "duplicating a flow must never be limited");
  });
}

async function testUnsupportedStorageIsKeptAside() {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "flows.json"), JSON.stringify({ version: 999, flows: [{ id: "future" }] }));
    await flowStore.initializeFlowStore(dir);
    assert.strictEqual(flowStore.getFlows().length, 0);
    const files = await fs.readdir(dir);
    assert.ok(files.some((name) => name.startsWith("flows.corrupt-")), "an unsupported storage file must be kept, not overwritten");
  });
}

async function testStoredFlowsWithOldOrRemovedActions() {
  await withTempDir(async (dir) => {
    const stored = {
      version: flowStore.STORAGE_VERSION,
      flows: [
        { id: "legacy", name: "Legacy", enabled: true, actions: [{ id: "a1", type: "open-app", params: { path: "notepad.exe" } }] },
        { id: "removed", name: "Removed", enabled: true, actions: [{ id: "a1", type: "pc.shutdown", params: {} }] },
      ],
    };
    await fs.writeFile(path.join(dir, flowStore.STORAGE_FILE), JSON.stringify(stored));
    await flowStore.initializeFlowStore(dir);
    const flows = flowStore.getFlows();
    assert.strictEqual(flows.length, 2, "flows with unknown actions must not be dropped on load");
    assert.strictEqual(flows[0].nodes[0].actionId, "app.open", "legacy action ids must still migrate");
    assert.strictEqual(flows[1].nodes[0].actionId, "pc.shutdown", "a removed action must stay visible so the user can delete it");
    const saved = await flowStore.updateFlow({ ...flows[1], name: "Renamed" });
    assert.strictEqual(saved.nodes[0].actionId, "pc.shutdown", "saving must keep the user's data even if an action no longer exists");
    const validation = validateFlow(saved);
    assert.ok(validation.errors.some((error) => error.code === "UNKNOWN_ACTION_TYPE"), "running such a flow must report the unknown action")
  });
}

async function run() {
  await testFlowCountIsNotLimited();
  await testDuplicateIsNotLimited();
  await testUnsupportedStorageIsKeptAside();
  await testStoredFlowsWithOldOrRemovedActions();
  console.log("flow store tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
