const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const swipeManager = require("./swipeManager.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swipey-swipe-manager-"));
}

async function setup({ masterEnabled = true, bindingEnabled = true } = {}) {
  let runCount = 0;
  const userData = tempDir();
  swipeManager.configureSwipeManager({
    flowStore: {
      findFlow: (flowId) => (flowId === "flow-a" || flowId === "flow-b" ? { id: flowId, name: `Flow ${flowId.slice(-1).toUpperCase()}`, enabled: true, actions: [] } : null),
    },
    flowExecutor: {
      runFlow: async (flowId) => {
        runCount += 1;
        return { success: true, flowId, flowName: "Flow A", actions: [] };
      },
    },
    isSwipesEnabled: () => masterEnabled,
  });
  await swipeManager.initializeSwipeManager(userData);
  await swipeManager.createBinding({ type: "swipe", fingers: 2, direction: "right", flowId: "flow-a", enabled: bindingEnabled });
  return { getRunCount: () => runCount };
}

(async () => {
  {
    const harness = await setup({ masterEnabled: false, bindingEnabled: true });
    const result = await swipeManager.handleGesture({ type: "gestureRecognized", gesture: "swipe", fingers: 2, direction: "right" });
    assert.strictEqual(result, null, "master off should ignore recognized swipes");
    assert.strictEqual(harness.getRunCount(), 0, "master off must not execute Flow");
  }

  {
    const harness = await setup({ masterEnabled: true, bindingEnabled: true });
    const result = await swipeManager.handleGesture({ type: "gestureRecognized", gesture: "swipe", fingers: 2, direction: "right" });
    assert.strictEqual(result.success, true, "master on should execute matching enabled binding");
    assert.strictEqual(result.flowId, "flow-a", "Swipe trigger should still execute its assigned Flow");
    assert.strictEqual(harness.getRunCount(), 1);
  }

  {
    const harness = await setup({ masterEnabled: true, bindingEnabled: false });
    const result = await swipeManager.handleGesture({ type: "gestureRecognized", gesture: "swipe", fingers: 2, direction: "right" });
    assert.strictEqual(result, null, "individual binding off should not execute even when master is on");
    assert.strictEqual(harness.getRunCount(), 0);
  }

  {
    let runCount = 0;
    const userData = tempDir();
    swipeManager.configureSwipeManager({
    flowStore: {
        findFlow: (flowId) => (flowId === "flow-a" || flowId === "flow-b" ? { id: flowId, name: `Flow ${flowId.slice(-1).toUpperCase()}`, enabled: true, actions: [] } : null),
      },
      flowExecutor: {
        runFlow: async () => {
          runCount += 1;
          return { success: true, flowId: "flow-a", flowName: "Flow A", actions: [] };
        },
      },
      isSwipesEnabled: () => true,
    });
    await swipeManager.initializeSwipeManager(userData);
    await assert.rejects(
      () => swipeManager.createBinding({ type: "swipe", fingers: 1, direction: "right", flowId: "flow-a", enabled: true }),
      /Choose 2 fingers/,
      "new 1-finger bindings should be rejected",
    );
    await assert.rejects(
      () => swipeManager.createBinding({ type: "swipe", fingers: 3, direction: "right", flowId: "flow-a", enabled: true }),
      /Choose 2 fingers/,
      "new 3-finger bindings should be rejected",
    );
    await assert.rejects(
      () => swipeManager.createBinding({ type: "swipe", fingers: 4, direction: "right", flowId: "flow-a", enabled: true }),
      /Choose 2 fingers/,
      "new 4-finger bindings should be rejected",
    );
    const result = await swipeManager.handleGesture({ type: "gestureRecognized", gesture: "swipe", fingers: 3, direction: "right" });
    assert.strictEqual(result, null, "3-finger gesture events must not execute Swipey Flows");
    assert.strictEqual(runCount, 0);
  }

  {
    const userData = tempDir();
    swipeManager.configureSwipeManager({
      flowStore: {
        findFlow: (flowId) => (flowId === "flow-a" || flowId === "flow-b" ? { id: flowId, name: `Flow ${flowId.slice(-1).toUpperCase()}`, enabled: true, actions: [] } : null),
      },
      flowExecutor: {
        runFlow: async (flowId) => ({ success: true, flowId, flowName: "Flow", actions: [] }),
      },
      isSwipesEnabled: () => true,
    });
    await swipeManager.initializeSwipeManager(userData);
    const directions = ["left", "right", "up", "down"];
    for (const direction of directions) {
      const saved = await swipeManager.createBinding({ type: "swipe", fingers: 2, direction, flowId: "flow-a", enabled: true });
      assert.strictEqual(saved.status, "registered", `${direction} should register`);
    }
    assert.strictEqual(swipeManager.listBindings().length, 4, "four unique 2-finger directions can exist");
    await assert.rejects(
      () => swipeManager.createBinding({ type: "swipe", fingers: 2, direction: "left", flowId: "flow-a", enabled: true }),
      /already assigned/,
      "duplicate directions cannot newly be created",
    );
  }

  {
    const userData = tempDir();
    swipeManager.configureSwipeManager({
      flowStore: {
        findFlow: (flowId) => (flowId === "flow-a" || flowId === "flow-b" ? { id: flowId, name: `Flow ${flowId.slice(-1).toUpperCase()}`, enabled: true, actions: [] } : null),
      },
      flowExecutor: {
        runFlow: async (flowId) => ({ success: true, flowId, flowName: "Flow", actions: [] }),
      },
      isSwipesEnabled: () => true,
    });
    await swipeManager.initializeSwipeManager(userData);
    const left = await swipeManager.createBinding({ type: "swipe", fingers: 2, direction: "left", flowId: "flow-a", enabled: true });
    const right = await swipeManager.createBinding({ type: "swipe", fingers: 2, direction: "right", flowId: "flow-a", enabled: true });
    const updated = await swipeManager.updateBinding({ ...right, flowId: "flow-b" });
    assert.strictEqual(updated.flowId, "flow-b", "flow assignment updates without changing the swipe signature");
    await assert.rejects(
      () => swipeManager.updateBinding({ ...right, direction: "left" }),
      /already assigned/,
      "already-used direction is unavailable to another row",
    );
    const storedLeft = swipeManager.listBindings().find((binding) => binding.id === left.id);
    assert.strictEqual(storedLeft.status, "registered", "existing unique direction remains registered");
  }

  console.log("swipeManager tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
