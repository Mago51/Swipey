const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const presetStore = require("./presetStore.js");

async function withTempDir(test) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swipey-presets-"));
  try {
    await test(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testSeedsAndPersistsPresets() {
  await withTempDir(async (dir) => {
    await presetStore.initializePresetStore(dir);
    assert.ok(presetStore.findPreset("preset-support-reply"), "default support preset should be seeded");

    const created = await presetStore.createPreset({ name: "Greeting", text: "Hello there" });
    assert.strictEqual(presetStore.findPreset(created.id).text, "Hello there");

    await presetStore.updatePreset({ ...created, name: "Greeting v2", text: "Updated text" });
    assert.strictEqual(presetStore.findPreset(created.id).name, "Greeting v2");

    await presetStore.initializePresetStore(dir);
    assert.strictEqual(presetStore.findPreset(created.id).text, "Updated text", "created preset should survive reload");

    await presetStore.deletePreset(created.id);
    assert.strictEqual(presetStore.findPreset(created.id), null);
  });
}

async function testValidation() {
  await withTempDir(async (dir) => {
    await presetStore.initializePresetStore(dir);
    await assert.rejects(
      () => presetStore.createPreset({ name: "Empty", text: "" }),
      (error) => error.code === "PRESET_TEXT_REQUIRED"
    );
    await assert.rejects(
      () => presetStore.createPreset({ name: "Too Long", text: "x".repeat(presetStore.MAX_PRESET_TEXT_LENGTH + 1) }),
      (error) => error.code === "PRESET_TEXT_TOO_LONG"
    );
  });
}

async function run() {
  await testSeedsAndPersistsPresets();
  await testValidation();
  console.log("preset store tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
