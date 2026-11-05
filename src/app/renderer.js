import { commandCategories, findCommand } from "../commands/catalog.js";
import { flowTemplates, templateActionLabels } from "../commands/flowTemplates.js";
import {
  addStep,
  actionCount,
  cloneFlow,
  createDraftFromTemplate,
  createFlowDraft,
  deleteFlow,
  describeStep,
  duplicateStep,
  duplicateFlow,
  findNode,
  findFlow,
  flows,
  loadFlows,
  moveStep,
  removeStep,
  saveFlowDraft,
  setFlowEnabled,
} from "../flows/flowStore.js";
import { createKeyTrigger, deleteKeyTrigger, keyTriggers, loadKeyTriggers, setKeyTriggerEnabled, updateKeyTrigger } from "../triggers/keyTriggers.js";
import { createSwipeTrigger, deleteSwipeTrigger, loadSwipeTriggers, setSwipeTriggerEnabled, swipeTriggers, updateSwipeTrigger } from "../triggers/swipeTriggers.js";

const state = {
  activeView: "flows",
  editorMode: "create",
  editorDraft: null,
  editorBaselineSnapshot: null,
  pendingNavigation: null,
  dialogOpen: false,
  titleBeforeEdit: "",
  openCategoryId: "apps",
  recordingKey: false,
  recordingStartedAt: null,
  swipesEnabled: false,
  swipeModeStatus: null,
  swipeModeBusy: false,
  runningFlowId: null,
  presets: [],
  flowSearchQuery: "",
  flowFilter: "all",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const SWIPE_DIRECTIONS = ["left", "right", "up", "down"];

const iconPaths = {
  "arrow-left": '<path d="M15 18l-6-6 6-6"/><path d="M9 12h12"/>',
  close: '<path d="M7 7l10 10"/><path d="M17 7L7 17"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  copy: '<rect x="8" y="8" width="10" height="10" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"/>',
  delete: '<path d="M6 7h12"/><path d="M9 7V5h6v2"/><path d="M9 10v7"/><path d="M15 10v7"/><path d="M7 7l1 12h8l1-12"/>',
  edit: '<path d="M5 19l4-1 9-9-3-3-9 9-1 4z"/><path d="M13 6l3 3"/>',
  flow: '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 7h4a4 4 0 0 1 4 4v4"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12 12 0 0 1 0 16"/><path d="M12 4a12 12 0 0 0 0 16"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  keyboard: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h.01"/><path d="M10 11h.01"/><path d="M13 11h.01"/><path d="M16 11h.01"/><path d="M8 14h8"/>',
  lock: '<rect x="6" y="10" width="12" height="9" rx="2"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/>',
  maximize: '<path d="M7 7h10v10H7z"/>',
  minus: '<path d="M7 12h10"/>',
  monitor: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 20h6"/><path d="M12 16v4"/>',
  more: '<circle cx="12" cy="6" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="18" r="1"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  save: '<path d="M5 5h12l2 2v12H5z"/><path d="M8 5v6h8"/><path d="M8 19v-5h8v5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/>',
  touchpad: '<rect x="5" y="4" width="14" height="16" rx="3"/><path d="M5 15h14"/><path d="M12 15v5"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  window: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/><path d="M8 5v4"/>',
};

function icon(name) {
  return `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] ?? iconPaths.flow}</svg>`;
}

function flowBadge(flow) {
  const categoryClass = categoryForFlow(flow);
  return `
    <span class="flow-badge ${categoryClass}" aria-hidden="true">
      <svg class="flow-badge-glyph" viewBox="0 0 36 36">
        <path class="flow-badge-path" d="M9.8 21.6c4.4 0 4.8-7.2 8.9-7.2h1.9c2.8 0 5-2.1 5-5"/>
        <path class="flow-badge-path secondary" d="M10.6 25.6h5.4c3.8 0 4.5-5.2 8.4-5.2h1.5"/>
        <circle class="flow-badge-node main" cx="9.8" cy="21.6" r="3.3"/>
        <circle class="flow-badge-node" cx="25.6" cy="9.4" r="3"/>
        <circle class="flow-badge-node end" cx="25.9" cy="20.4" r="2.8"/>
      </svg>
    </span>`;
}

function hydrateIcons(root = document) {
  root.querySelectorAll(".icon[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function triggerCollections() {
  return [...keyTriggers, ...swipeTriggers];
}

function triggersForFlow(flowId) {
  return triggerCollections().filter((trigger) => trigger.flowId === flowId);
}

function triggerLabel(trigger) {
  if (trigger.type === "key") return trigger.displayName;
  if (trigger.type === "swipe") return conciseSwipeLabel(trigger);
  if (trigger.keys) return trigger.keys.join(" + ");
  return trigger.gesture;
}

function conciseSwipeLabel(trigger) {
  const direction = String(trigger.direction || "").toLowerCase();
  if (Number(trigger.fingers) === 2 && SWIPE_DIRECTIONS.includes(direction)) return `Swipe ${capitalize(direction)}`;
  return trigger.displayName || `${trigger.fingers} Fingers - Swipe ${capitalize(direction)}`;
}

function renderTriggerPreview(trigger) {
  if (trigger.type === "key") {
    return `<span class="trigger-preview key-preview">${trigger.displayName
      .split(" + ")
      .map((key) => `<span class="keycap">${escapeHtml(key)}</span>`)
      .join('<span class="key-plus">+</span>')}</span>`;
  }
  if (trigger.keys) {
    return `<span class="trigger-preview key-preview">${trigger.keys.map((key) => `<span class="keycap">${escapeHtml(key)}</span>`).join('<span class="key-plus">+</span>')}</span>`;
  }
  return `<span class="trigger-preview swipe-preview"><span class="trigger-chip">${escapeHtml(triggerLabel(trigger))}</span></span>`;
}

function flowActionText(flow) {
  const count = actionCount(flow);
  return `${count} ${count === 1 ? "action" : "actions"}`;
}

// Vergleichsstand für den Dialog bei ungespeicherten Änderungen.
// Enthalten ist nur, was wirklich gespeichert wird.
function flowSnapshot(flow) {
  if (!flow) return null;
  return JSON.stringify({
    id: flow.id,
    name: flow.name,
    enabled: flow.enabled,
    actions: flow.actions.map((action) => ({
      id: action.id,
      type: action.type,
      params: { ...action.params },
    })),
  });
}

function hasUnsavedEditorChanges() {
  if (state.activeView !== "flow-editor" || !state.editorDraft) return false;
  // Ein neuer Flow, der noch nie gespeichert wurde, zählt immer als geändert.
  if (state.editorBaselineSnapshot === null) return true;
  return flowSnapshot(state.editorDraft) !== state.editorBaselineSnapshot;
}

function updateUnsavedIndicator() {
  const isDirty = hasUnsavedEditorChanges();
  $("#editor-save")?.classList.toggle("has-changes", isDirty);
  updateRunButton();
}

function updateRunButton() {
  const button = $("#editor-run");
  if (!button) return;
  const isRunning = !!state.editorDraft && state.runningFlowId === state.editorDraft.id;
  button.innerHTML = isRunning
    ? `${icon("close")}<span>Stop</span>`
    : `${icon("flow")}<span>Run Flow</span>`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function switchView(viewName) {
  state.activeView = viewName;
  closeContextMenu();
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  $$(".nav-item").forEach((item) => {
    const isActive = item.dataset.view === viewName || (viewName === "flow-editor" && item.dataset.view === "flows");
    item.classList.toggle("active", isActive);
  });
}

// Alle Wege aus dem Editor laufen hier durch. So gibt es den Dialog für ungespeicherte
// Änderungen nur an einer Stelle.
function requestNavigation(action) {
  if (state.dialogOpen) return;
  if (hasUnsavedEditorChanges()) {
    openUnsavedDialog(action);
    return;
  }
  action();
}

function openUnsavedDialog(action) {
  state.pendingNavigation = action;
  state.dialogOpen = true;
  const dialog = $("#unsaved-dialog");
  dialog.classList.add("open");
  dialog.setAttribute("aria-hidden", "false");
  $("#dialog-stay").focus();
}

function closeUnsavedDialog() {
  state.dialogOpen = false;
  state.pendingNavigation = null;
  const dialog = $("#unsaved-dialog");
  dialog.classList.remove("open");
  dialog.setAttribute("aria-hidden", "true");
}

function leaveWithoutSaving() {
  const action = state.pendingNavigation;
  closeUnsavedDialog();
  if (action) action();
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function directionLabel(direction) {
  const normalized = String(direction || "").toLowerCase();
  const glyphs = {
    down: "↓",
    left: "←",
    right: "→",
    up: "↑",
  };
  return `${glyphs[normalized] || ""} ${capitalize(normalized)}`.trim();
}

function updateFlowFilterButtons() {
  $$("#flow-filter .segmented-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.flowFilter);
  });
}

function filteredFlows() {
  const query = state.flowSearchQuery.trim().toLowerCase();
  const searched = query ? flows.filter((flow) => flow.name.toLowerCase().includes(query)) : flows;
  if (state.flowFilter === "enabled") return searched.filter((flow) => flow.enabled);
  if (state.flowFilter === "disabled") return searched.filter((flow) => !flow.enabled);
  return searched;
}

function renderFlowsOverview() {
  if (flows.length === 0) {
    $("#flows-overview").innerHTML = `
      <div class="empty-state compact">
        ${icon("flow")}
        <h2>No flows yet</h2>
        <p>Create your first reusable automation, or start from a template.</p>
        <div class="empty-state-actions">
          <button class="button primary" id="empty-create-flow" type="button">${icon("plus")}<span>Create Flow</span></button>
          <button class="button secondary" id="empty-browse-templates" type="button"><span>Browse Templates</span></button>
        </div>
      </div>`;
    $("#empty-create-flow").addEventListener("click", openTemplatePickerDialog);
    $("#empty-browse-templates").addEventListener("click", openTemplatePickerDialog);
    return;
  }

  const visible = filteredFlows();
  const query = state.flowSearchQuery.trim();
  if (visible.length === 0) {
    if (query) {
      $("#flows-overview").innerHTML = `
        <div class="empty-state compact">
          ${icon("flow")}
          <h2>No flows match "${escapeHtml(query)}"</h2>
          <p>Try a different search term.</p>
          <button class="button secondary" id="clear-flow-search" type="button"><span>Clear search</span></button>
        </div>`;
      $("#clear-flow-search").addEventListener("click", () => {
        state.flowSearchQuery = "";
        const input = $("#flow-search");
        if (input) input.value = "";
        renderFlowsOverview();
      });
    } else {
      $("#flows-overview").innerHTML = `
        <div class="empty-state compact">
          ${icon("flow")}
          <h2>No ${state.flowFilter} flows</h2>
          <p>Nothing matches this filter yet.</p>
          <button class="button secondary" id="clear-flow-filter" type="button"><span>Show all</span></button>
        </div>`;
      $("#clear-flow-filter").addEventListener("click", () => {
        state.flowFilter = "all";
        updateFlowFilterButtons();
        renderFlowsOverview();
      });
    }
    return;
  }

  const assigned = visible.filter((flow) => flow.enabled && triggersForFlow(flow.id).length > 0);
  const unassigned = visible.filter((flow) => flow.enabled && triggersForFlow(flow.id).length === 0);
  const disabled = visible.filter((flow) => !flow.enabled);
  const sections = [
    { title: "Assigned", flows: assigned },
    { title: "Unassigned", flows: unassigned },
    { title: "Disabled", flows: disabled },
  ];

  $("#flows-overview").innerHTML = sections
    .filter((section) => section.flows.length > 0)
    .map(
      (section) => `
      <section class="flow-section">
        <div class="section-heading">
          <span>${section.title}</span>
          <span>${section.flows.length}</span>
        </div>
        <div class="flow-section-list">
          ${section.flows.map(renderFlowRow).join("")}
        </div>
      </section>`
    )
    .join("");

  $$(".flow-overview-row").forEach((row) => {
    row.addEventListener("dblclick", () => openEditEditor(row.dataset.flowId));
  });
  $$(".flow-menu-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openFlowContextMenu(button.dataset.flowId, button);
    });
  });
  $$(".flow-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFlowEnabled(toggle.dataset.flowId);
    });
  });
}

function renderFlowRow(flow) {
  const triggers = triggersForFlow(flow.id);
  const triggerMeta = triggers.length ? `${triggers.length} ${triggers.length === 1 ? "trigger" : "triggers"}` : "No trigger";
  const isRunning = flow.id === state.runningFlowId;
  return `
    <div class="flow-overview-row ${flow.enabled ? "" : "disabled"}" data-flow-id="${flow.id}">
      <div class="flow-identity">
        ${flowBadge(flow)}
        <span class="flow-copy">
          <span class="flow-name">${escapeHtml(flow.name)}${isRunning ? ' <span class="status-pill ok">Running</span>' : ""}</span>
          <span class="flow-meta">${flowActionText(flow)} - ${triggerMeta}</span>
          <span class="flow-triggers">${triggers.length ? triggers.map(renderTriggerPreview).join("") : '<span class="no-trigger-text">No trigger assigned</span>'}</span>
        </span>
      </div>
      <div class="flow-row-actions">
        ${renderToggle(flow.enabled, `Flow ${flow.enabled ? "enabled" : "disabled"}`, "flow-toggle", flow.id)}
        <button class="icon-button flow-menu-button" data-flow-id="${flow.id}" title="Flow actions" type="button">${icon("more")}</button>
      </div>
    </div>`;
}

function renderToggle(checked, label, className = "", flowId = "") {
  return `
    <button class="toggle-switch ${checked ? "is-on" : ""} ${className}" data-flow-id="${flowId}" type="button" role="switch" aria-checked="${checked}" aria-label="${escapeHtml(label)}">
      <span class="toggle-thumb"></span>
    </button>`;
}

function categoryForFlow(flow) {
  const first = flow.actions.map((action) => findCommand(action.type)?.type).find(Boolean);
  return first ?? "app";
}

function openFlowContextMenu(flowId, anchor) {
  const flow = findFlow(flowId);
  if (!flow) return;
  const menu = $("#flow-context-menu");
  menu.innerHTML = `
    <button data-action="edit" type="button">${icon("edit")}<span>Edit</span></button>
    <button data-action="duplicate" type="button">${icon("copy")}<span>Duplicate</span></button>
    <button data-action="assign" type="button">${icon("keyboard")}<span>Assign Trigger</span></button>
    <button data-action="delete" class="danger" type="button">${icon("delete")}<span>Delete</span></button>
  `;

  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.min(rect.right - 190, window.innerWidth - 206)}px`;
  menu.classList.add("open");

  menu.querySelectorAll("button").forEach((item) => {
    item.addEventListener("click", () => {
      handleFlowMenuAction(flowId, item.dataset.action);
      closeContextMenu();
    });
  });
}

function closeContextMenu() {
  $("#flow-context-menu").classList.remove("open");
}

async function handleFlowMenuAction(flowId, action) {
  const flow = findFlow(flowId);
  if (!flow) return;
  if (action === "edit") openEditEditor(flowId);
  if (action === "duplicate") {
    try {
      await duplicateFlow(flow);
      renderAll();
      showToast("Flow duplicated.");
    } catch (error) {
      showToast(error.message);
    }
  }
  if (action === "assign") {
    switchView("keys");
    showToast("Choose an existing key trigger or record a new one for this Flow.");
  }
  if (action === "delete") {
    try {
      await deleteFlow(flowId);
      removeTriggerAssignments(flowId);
      await loadKeyTriggers();
      await loadSwipeTriggers();
      renderAll();
      showToast("Flow deleted.");
    } catch (error) {
      showToast(error.message);
    }
  }
}

async function toggleFlowEnabled(flowId) {
  const flow = findFlow(flowId);
  if (!flow) return;
  try {
    const updated = await setFlowEnabled(flowId, !flow.enabled);
    renderAll();
    showToast(updated.enabled ? "Flow enabled." : "Flow moved to Disabled.");
  } catch (error) {
    showToast(error.message);
  }
}

function removeTriggerAssignments(flowId) {
  [swipeTriggers].forEach((collection) => {
    for (let index = collection.length - 1; index >= 0; index -= 1) {
      if (collection[index].flowId === flowId) collection.splice(index, 1);
    }
  });
}

function openCreateEditor() {
  state.editorMode = "create";
  state.editorDraft = createFlowDraft();
  state.editorBaselineSnapshot = null;
  switchView("flow-editor");
  renderEditor();
  $("#editor-flow-name").focus();
  $("#editor-flow-name").select();
}

function startBlankFlow() {
  closeTemplatePickerDialog();
  openCreateEditor();
}

function openTemplatePickerDialog() {
  state.dialogOpen = true;
  renderTemplatePicker();
  const dialog = $("#template-picker-dialog");
  dialog.classList.add("open");
  dialog.setAttribute("aria-hidden", "false");
}

function closeTemplatePickerDialog() {
  state.dialogOpen = false;
  const dialog = $("#template-picker-dialog");
  dialog.classList.remove("open");
  dialog.setAttribute("aria-hidden", "true");
}

function renderTemplatePicker() {
  const grid = $("#template-grid");
  if (!grid) return;
  grid.innerHTML = flowTemplates
    .map((template) => {
      const actionLabels = templateActionLabels(template);
      return `
        <div class="template-card" data-template-id="${template.id}">
          <div class="template-card-heading">
            <span class="template-category">${escapeHtml(template.category)}</span>
          </div>
          <h3 class="template-name">${escapeHtml(template.name)}</h3>
          <p class="template-description">${escapeHtml(template.description)}</p>
          <div class="template-actions-used">${actionLabels.map((label) => `<span class="template-action-chip">${escapeHtml(label)}</span>`).join("")}</div>
          <button class="button primary template-use-button" data-template-id="${template.id}" type="button">
            <span>Use Template</span>
          </button>
        </div>`;
    })
    .join("");

  grid.querySelectorAll(".template-use-button").forEach((button) => {
    button.addEventListener("click", () => useTemplate(button.dataset.templateId));
  });
}

async function useTemplate(templateId) {
  const template = flowTemplates.find((item) => item.id === templateId);
  if (!template) return;
  try {
    const saved = await saveFlowDraft(createDraftFromTemplate(template));
    closeTemplatePickerDialog();
    renderAll();
    showToast(`"${saved.name}" created from template.`);
    openEditEditor(saved.id);
  } catch (error) {
    showToast(error.message);
  }
}

function openEditEditor(flowId) {
  const flow = findFlow(flowId);
  if (!flow) return;
  state.editorMode = "edit";
  state.editorDraft = cloneFlow(flow);
  state.editorBaselineSnapshot = flowSnapshot(state.editorDraft);
  switchView("flow-editor");
  renderEditor();
}

function closeEditor() {
  state.editorDraft = null;
  state.editorBaselineSnapshot = null;
  switchView("flows");
  renderAll();
}

async function saveEditor() {
  if (!state.editorDraft) return;
  state.editorDraft.name = $("#editor-flow-name").value.trim() || "Untitled Flow";
  try {
    const saved = await saveFlowDraft(state.editorDraft);
    state.editorBaselineSnapshot = flowSnapshot(saved);
    showToast("Flow saved.");
    closeEditor();
  } catch (error) {
    showToast(`Save failed: ${error.message}`);
    updateUnsavedIndicator();
  }
}

function renderEditor() {
  const draft = state.editorDraft;
  if (!draft) return;
  $("#editor-flow-name").value = draft.name;
  updateUnsavedIndicator();
  updateRunButton();
  renderCommandLibrary();
  renderFlowCanvas();
}

async function runEditorFlow() {
  if (!state.editorDraft) return;
  if (state.runningFlowId === state.editorDraft.id) {
    await stopEditorFlow(state.editorDraft.id);
    return;
  }
  if (state.runningFlowId) return;
  if (hasUnsavedEditorChanges()) {
    showToast("Save this Flow before running it.");
    return;
  }

  state.runningFlowId = state.editorDraft.id;
  updateRunButton();
  try {
    const result = await window.swipey?.flowExecutor?.run?.(state.editorDraft.id);
    if (result?.error?.code === "FLOW_CANCELLED") {
      showToast("Flow stopped.");
      return;
    }
    if (result?.success) {
      showToast("Flow completed successfully.");
      return;
    }
    showToast(result?.message || "Flow failed.");
    console.warn("[flows] Flow execution failed", result);
  } catch (error) {
    console.error("[flows] Flow execution error", error);
    showToast(`Flow failed: ${error.message}`);
  } finally {
    state.runningFlowId = null;
    updateRunButton();
  }
}

async function stopEditorFlow(flowId) {
  try {
    await window.swipey?.flowExecutor?.stop?.(flowId);
  } catch (error) {
    console.error("[flows] Stop flow request failed", error);
  }
}

function renderCommandLibrary() {
  $("#command-categories").innerHTML = commandCategories.map(renderCommandCategory).join("");
  $$(".category-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.openCategoryId = state.openCategoryId === button.dataset.categoryId ? "" : button.dataset.categoryId;
      renderCommandLibrary();
    });
  });
  $$(".library-command").forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", item.dataset.commandId);
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setDragImage(item, 14, 14);
    });
    item.addEventListener("click", () => {
      if (!state.editorDraft) return;
      if (!addStep(state.editorDraft, item.dataset.commandId)) return;
      updateUnsavedIndicator();
      renderFlowCanvas();
    });
  });
}

function renderCommandCategory(category) {
  const isOpen = state.openCategoryId === category.id;
  return `
    <div class="category-group ${category.colorToken} ${isOpen ? "open" : ""}">
      <button class="category-card ${category.colorToken}" data-category-id="${category.id}" type="button">
        <span class="category-icon">${icon(category.icon)}</span>
        <span class="category-copy">
          <span>${category.label}</span>
          <span>${category.description}</span>
        </span>
      </button>
      <div class="library-command-list">
        ${category.commands
          .map(
            (command) => `
            <button class="library-command ${category.colorToken}" data-command-id="${command.id}" draggable="true" type="button" title="${escapeHtml(command.description || command.label)}">
              <span class="library-command-row">
                <span class="library-command-main">${commandActionIcon(command)}<span class="library-command-copy"><span class="library-command-name">${escapeHtml(command.label)}</span><span class="library-command-description">${escapeHtml(command.description || "")}</span></span></span>
              </span>
            </button>`
          )
          .join("")}
      </div>
    </div>`;
}

function commandActionIcon(command) {
  const commandId = command.id ?? "";
  if (commandId.includes("website") || command.type === "web") return icon("globe");
  if (commandId.includes("wait")) return icon("clock");
  if (commandId.includes("lock")) return icon("lock");
  if (command.type === "pc") return icon("monitor");
  return icon("window");
}

function renderFlowCanvas() {
  const draft = state.editorDraft;
  if (!draft) return;
  const nodes = draft.nodes || [];
  $("#flow-chain").classList.toggle("is-empty", nodes.length === 0);
  $("#flow-chain").innerHTML = [
    insertionSlot(0),
    ...nodes.flatMap((node, index) => [renderFlowNode(node, index), insertionSlot(index + 1)]),
    nodes.length === 0 ? '<div class="empty-flow-helper">Add your first command</div>' : "",
  ].join("");

  $$(".flow-block").forEach((block) => {
    block.addEventListener("dragstart", (event) => {
      if (block.closest(".nested-node")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData("application/x-swipey-step", block.dataset.index);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setDragImage(block, 20, 20);
      block.classList.add("dragging");
    });
    block.addEventListener("dragend", () => block.classList.remove("dragging"));
  });

  $$(".block-action").forEach((button) => {
    button.addEventListener("click", () => handleBlockAction(button.dataset.action, button.dataset.stepId));
  });

  $$(".insert-slot").forEach((slot) => {
    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.classList.add("drag-over");
    });
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      slot.classList.remove("drag-over");
      const insertIndex = Number(slot.dataset.index);
      const commandId = event.dataTransfer.getData("text/plain");
      const stepIndex = event.dataTransfer.getData("application/x-swipey-step");

      if (commandId) addStep(draft, commandId, insertIndex);
      if (stepIndex !== "") {
        const fromIndex = Number(stepIndex);
        const toIndex = fromIndex < insertIndex ? insertIndex - 1 : insertIndex;
        moveStep(draft, fromIndex, toIndex);
      }
      updateUnsavedIndicator();
      renderEditor();
    });
  });
  bindActionParamEditors();
}

function renderFlowNode(node, index) {
  if (node.type !== "action") return renderContainerNode(node, index);
  return renderFlowBlock(node, index);
}

function renderFlowBlock(action, index) {
  const actionType = action.actionId || action.type;
  const command = findCommand(actionType);
  const type = command?.type ?? "app";
  return `
    <div class="flow-block ${type}" data-index="${index}" data-step-id="${action.id}" draggable="true">
      <div class="block-grip" title="Drag to reorder"></div>
      <div class="block-command-icon">${commandActionIcon(command ?? { type })}</div>
      <div class="block-main">
        <span class="block-name">${escapeHtml(describeStep(action))}</span>
        <span class="block-kicker">${type.toUpperCase()}</span>
        ${renderActionParams(action)}
      </div>
      <div class="block-controls">
        <button class="block-action" data-action="duplicate" data-step-id="${action.id}" title="Duplicate command" type="button">${icon("copy")}</button>
        <button class="block-action" data-action="delete" data-step-id="${action.id}" title="Delete command" type="button">${icon("close")}</button>
      </div>
    </div>`;
}

function renderContainerNode(node, index) {
  return `
    <div class="flow-block event logic-container" data-index="${index}" data-step-id="${node.id}" draggable="true">
      <div class="block-grip" title="Drag to reorder"></div>
      <div class="block-command-icon">${commandActionIcon({ type: "event" })}</div>
      <div class="block-main">
        <span class="block-name">${escapeHtml(describeStep(node))}</span>
        <span class="block-kicker">EVENT LOGIC</span>
        ${renderLogicParams(node)}
        ${renderLogicChildren(node)}
      </div>
      <div class="block-controls">
        <button class="block-action" data-action="duplicate" data-step-id="${node.id}" title="Duplicate logic" type="button">${icon("copy")}</button>
        <button class="block-action" data-action="delete" data-step-id="${node.id}" title="Delete logic" type="button">${icon("close")}</button>
      </div>
    </div>`;
}

function renderLogicParams(node) {
  if (node.type === "repeat") return logicNumberField(node, "count", "Count", node.count);
  if (node.type === "if") return renderConditionParams(node);
  if (node.type === "wait-until") return renderConditionParams(node) + logicNumberField(node, "timeoutMs", "Timeout", node.timeoutMs) + logicNumberField(node, "pollIntervalMs", "Poll", node.pollIntervalMs);
  if (node.type === "delay-between-actions" || node.type === "run-after-delay") return logicNumberField(node, "delayMs", "Delay", node.delayMs);
  return "";
}

const VARIABLE_CONDITION_OPERATORS = [
  ["variable.equals", "Equals"],
  ["variable.not-equals", "Not Equals"],
  ["variable.greater-than", "Greater Than"],
  ["variable.greater-or-equal", "Greater or Equal"],
  ["variable.less-than", "Less Than"],
  ["variable.less-or-equal", "Less or Equal"],
  ["variable.contains", "Contains"],
  ["variable.is-true", "Is True"],
  ["variable.is-false", "Is False"],
  ["variable.exists", "Exists"],
];
const VARIABLE_CONDITIONS_WITHOUT_VALUE = new Set(["variable.exists", "variable.is-true", "variable.is-false"]);
const NUMBER_ONLY_CONDITIONS = new Set(["variable.greater-than", "variable.greater-or-equal", "variable.less-than", "variable.less-or-equal"]);

function conditionFamily(type) {
  if (typeof type === "string" && type.startsWith("variable.")) return "variable";
  if (typeof type === "string" && type.startsWith("execution.")) return "execution";
  return "app";
}

function renderConditionParams(node) {
  const condition = node.condition || {};
  const family = conditionFamily(condition.type);
  const familySelect = logicSelectField(node, "conditionFamily", "Condition Type", family, [
    ["app", "App"],
    ["variable", "Variable"],
    ["execution", "Execution Result"],
  ]);
  if (family === "variable") return familySelect + renderVariableConditionFields(node, condition);
  if (family === "execution") return familySelect + renderExecutionConditionFields(node, condition);
  return familySelect + renderAppConditionFields(node, condition);
}

function renderAppConditionFields(node, condition) {
  const target = condition.target || {};
  return [
    logicSelectField(node, "conditionType", "State", condition.type || "app-running", [["app-running", "App Running"], ["app-not-running", "App Not Running"]]),
    logicTextField(node, "processName", "Process", target.processName || "notepad.exe"),
  ].join("");
}

function renderVariableConditionFields(node, condition) {
  const type = VARIABLE_CONDITION_OPERATORS.some(([id]) => id === condition.type) ? condition.type : "variable.equals";
  const fields = [
    logicTextField(node, "variableName", "Variable", condition.variableName || ""),
    logicSelectField(node, "conditionType", "Operator", type, VARIABLE_CONDITION_OPERATORS),
  ];
  if (!VARIABLE_CONDITIONS_WITHOUT_VALUE.has(type)) {
    const forcedType = NUMBER_ONLY_CONDITIONS.has(type) ? "number" : type === "variable.contains" ? "string" : condition.compareType || "string";
    if (!NUMBER_ONLY_CONDITIONS.has(type) && type !== "variable.contains") {
      fields.push(logicSelectField(node, "compareType", "Value Type", forcedType, [["string", "Text"], ["number", "Number"], ["boolean", "True/False"]]));
    }
    if (forcedType === "boolean") {
      fields.push(logicSelectField(node, "compareValue", "Value", condition.compareValue === true ? "true" : "false", [["true", "True"], ["false", "False"]]));
    } else {
      fields.push(logicTextField(node, "compareValue", "Value", condition.compareValue ?? "", forcedType === "number" ? "number" : "text"));
    }
  }
  return fields.join("");
}

function renderExecutionConditionFields(node, condition) {
  return logicSelectField(node, "conditionType", "Result", condition.type || "execution.last-action-succeeded", [
    ["execution.last-action-succeeded", "Last Action Succeeded"],
    ["execution.last-action-failed", "Last Action Failed"],
  ]);
}

function logicNumberField(node, param, label, value) {
  return `<label class="block-param"><span>${escapeHtml(label)}</span><input class="logic-param-field block-param-field" data-step-id="${node.id}" data-param="${param}" type="number" value="${escapeHtml(value ?? "")}" draggable="false" /></label>`;
}

function logicTextField(node, param, label, value, inputType = "text") {
  return `<label class="block-param"><span>${escapeHtml(label)}</span><input class="logic-param-field block-param-field" data-step-id="${node.id}" data-param="${param}" type="${inputType}" value="${escapeHtml(value ?? "")}" draggable="false" /></label>`;
}

function logicSelectField(node, param, label, value, options) {
  return `<label class="block-param"><span>${escapeHtml(label)}</span><select class="logic-param-field block-param-field" data-step-id="${node.id}" data-param="${param}" draggable="false">${options.map(([optionValue, text]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function renderLogicChildren(node) {
  if (node.type === "if") return renderNodeSlot(node, "then", "THEN", node.then || []) + renderNodeSlot(node, "else", "ELSE", node.else || []);
  if (node.type === "try") return renderNodeSlot(node, "children", "TRY", node.children || []) + renderNodeSlot(node, "onError", "ON ERROR", node.onError || [], "on-error");
  if (node.type === "random-choice") {
    return (node.branches || []).map((branch, index) => renderNodeSlot(node, `branch:${index}`, `Option ${index + 1}`, branch)).join("") +
      `<button class="block-inline-action add-random-branch" data-step-id="${node.id}" type="button">Add Option</button>`;
  }
  if (node.children) return renderNodeSlot(node, "children", "ACTIONS", node.children);
  return "";
}

function renderNodeSlot(parent, slot, label, nodes, titleVariant = "") {
  return `
    <div class="logic-slot">
      <div class="logic-slot-title ${titleVariant}">${escapeHtml(label)}</div>
      ${nodes.length ? nodes.map((node, index) => `<div class="nested-node">${renderFlowNode(node, index)}</div>`).join("") : `<div class="logic-empty">No actions</div>`}
      <select class="nested-add-select" data-parent-id="${parent.id}" data-slot="${slot}">
        <option value="">Add action</option>
        ${nestedActionOptions()}
      </select>
    </div>`;
}

function nestedActionOptions() {
  return commandCategories.flatMap((category) =>
    category.commands
      .filter((command) => !command.nodeKind)
      .map((command) => `<option value="${escapeHtml(command.id)}">${escapeHtml(category.label)} - ${escapeHtml(command.label)}</option>`)
  ).join("");
}

function renderActionParams(action) {
  const actionType = action.actionId || action.type;
  const params = action.config || action.params || {};
  const value = (name, fallback = "") => escapeHtml(params?.[name] ?? fallback);
  if (["app.focus", "app.minimize", "app.maximize"].includes(actionType)) {
    return [
      paramField(action, "processName", "Process", value("processName", "notepad.exe")),
      paramField(action, "windowTitle", "Title", value("windowTitle", "")),
    ].join("");
  }
  if (actionType === "app.moveToPosition") {
    return [
      paramField(action, "processName", "Process", value("processName", "notepad.exe")),
      paramSelect(action, "position", "Position", params?.position || "left-half", [
        ["left-half", "Left Half"],
        ["right-half", "Right Half"],
        ["top-left", "Top Left"],
        ["top-right", "Top Right"],
        ["bottom-left", "Bottom Left"],
        ["bottom-right", "Bottom Right"],
        ["center", "Center"],
      ]),
    ].join("");
  }
  if (actionType === "app.waitUntilOpens") {
    return [
      paramField(action, "processName", "Process", value("processName", "notepad.exe")),
      paramField(action, "timeoutMs", "Timeout", value("timeoutMs", 30000), "number"),
    ].join("");
  }
  if (actionType === "app.open") {
    return paramField(action, "path", "Application", value("path", "notepad.exe"));
  }
  if (actionType === "app.close") {
    return paramField(action, "processName", "Process", value("processName", "notepad.exe"));
  }
  if (actionType === "web.openWebsite") {
    return paramField(action, "url", "Website", value("url", "https://example.com")) + variableInsertControl(action, "url");
  }
  if (actionType === "web.openInBrowser") {
    return [
      paramField(action, "url", "Website", value("url", "https://example.com")),
      browserParam(action, params?.browserId || "edge"),
    ].join("");
  }
  if (actionType === "web.openMultiple") {
    return [
      paramTextarea(action, "urls", "Websites", Array.isArray(params?.urls) ? params.urls.join("\n") : "https://example.com"),
      browserParam(action, params?.browserId || "default", true),
      paramField(action, "delayMs", "Delay", value("delayMs", 250), "number"),
    ].join("");
  }
  if (actionType === "web.searchGoogle" || actionType === "web.searchYouTube") {
    return paramField(action, "query", "Search", value("query", "Swipey")) + variableInsertControl(action, "query");
  }
  if (actionType === "event.wait") {
    return paramField(action, "milliseconds", "Milliseconds", value("milliseconds", 1000), "number");
  }
  if (actionType === "event.runFlow") {
    return runFlowParam(action);
  }
  if (actionType === "pc.typeText") {
    return paramField(action, "text", "Text", value("text", "Hello from Swipey")) + variableInsertControl(action, "text");
  }
  if (actionType === "pc.pressKey") {
    return paramField(action, "key", "Key", value("key", "ENTER"));
  }
  if (actionType === "pc.pressKeyCombination") {
    return paramField(action, "combination", "Keys", value("combination", "CTRL+SHIFT+S"));
  }
  if (actionType === "pc.setVolume") {
    return paramField(action, "percent", "Percent", value("percent", 50), "number");
  }
  if (actionType === "pc.pastePresetText") {
    return presetParam(action);
  }
  if (actionType === "pc.keyboardSequence") {
    return paramTextarea(action, "steps", "Steps", JSON.stringify(params?.steps || [], null, 2));
  }
  if (actionType === "event.setVariable") {
    const valueType = params?.valueType || "string";
    return [
      paramField(action, "name", "Name", value("name", "counter")),
      paramSelect(action, "valueType", "Type", valueType, [["string", "Text"], ["number", "Number"], ["boolean", "True/False"]]),
      variableValueField(action, valueType, params?.value),
    ].join("");
  }
  if (actionType === "event.incrementVariable" || actionType === "event.decrementVariable") {
    return [
      paramField(action, "name", "Name", value("name", "counter")),
      paramField(action, "amount", "Amount", value("amount", 1), "number"),
    ].join("");
  }
  if (actionType === "event.stopWithError") {
    return paramField(action, "message", "Message", value("message", "Flow stopped with an error.")) + variableInsertControl(action, "message");
  }
  return "";
}

function variableValueField(action, valueType, currentValue) {
  if (valueType === "boolean") {
    return paramSelect(action, "value", "Value", currentValue === true ? "true" : "false", [["true", "True"], ["false", "False"]]);
  }
  if (valueType === "number") return paramField(action, "value", "Value", currentValue ?? 0, "number");
  return paramField(action, "value", "Value", currentValue ?? "");
}

function collectKnownVariableNames(draft, targetStepId) {
  const names = new Set();
  let stopped = false;
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (stopped) return;
      if (node.id === targetStepId) {
        stopped = true;
        return;
      }
      if (node.type === "action" && node.actionId === "event.setVariable" && node.config?.name) names.add(node.config.name);
      for (const list of [node.children, node.then, node.else, node.onError, ...(node.branches || [])].filter(Boolean)) {
        walk(list);
        if (stopped) return;
      }
    }
  };
  walk(draft?.nodes || []);
  return [...names];
}

function variableInsertControl(action, param) {
  const names = collectKnownVariableNames(state.editorDraft, action.id);
  if (names.length === 0) return "";
  return `
    <select class="variable-insert-select" data-step-id="${action.id}" data-target-param="${param}">
      <option value="">+ Variable</option>
      ${names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
    </select>`;
}

function paramField(action, param, label, currentValue, inputType = "text") {
  return `
    <label class="block-param">
      <span>${escapeHtml(label)}</span>
      <input class="block-param-field" data-step-id="${action.id}" data-param="${param}" type="${inputType}" value="${currentValue}" draggable="false" />
    </label>`;
}

function paramTextarea(action, param, label, currentValue) {
  return `
    <label class="block-param block-param-wide">
      <span>${escapeHtml(label)}</span>
      <textarea class="block-param-field block-param-textarea" data-step-id="${action.id}" data-param="${param}" draggable="false">${escapeHtml(currentValue)}</textarea>
    </label>`;
}

function paramSelect(action, param, label, currentValue, options) {
  return `
    <label class="block-param">
      <span>${escapeHtml(label)}</span>
      <select class="block-param-field" data-step-id="${action.id}" data-param="${param}" draggable="false">
        ${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${value === currentValue ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
      </select>
    </label>`;
}

function browserParam(action, currentValue, includeDefault = false) {
  const options = [
    ...(includeDefault ? [["default", "Default"]] : []),
    ["edge", "Edge"],
    ["chrome", "Chrome"],
    ["firefox", "Firefox"],
    ["brave", "Brave"],
    ["opera", "Opera"],
  ];
  return paramSelect(action, "browserId", "Browser", currentValue, options);
}

function presetParam(action) {
  const selected = action.config?.presetId || action.params?.presetId || "";
  const options = state.presets.map((preset) => `<option value="${escapeHtml(preset.id)}" ${preset.id === selected ? "selected" : ""}>${escapeHtml(preset.name)}</option>`).join("");
  return `
    <label class="block-param">
      <span>Preset</span>
      <select class="block-param-field" data-step-id="${action.id}" data-param="presetId" draggable="false">
        <option value="" ${selected ? "" : "selected"}>Choose Preset</option>
        ${options}
      </select>
    </label>
    <button class="block-inline-action create-preset-button" data-step-id="${action.id}" type="button">Create Preset</button>`;
}

function runFlowParam(action) {
  const selectedFlowId = action.config?.flowId || action.params?.flowId || "";
  const currentFlowId = state.editorDraft?.id || "";
  const options = flows
    .filter((flow) => flow.id !== currentFlowId || flow.id === selectedFlowId)
    .map((flow) => `<option value="${flow.id}" ${flow.id === selectedFlowId ? "selected" : ""} ${flow.id === currentFlowId ? "disabled" : ""}>${escapeHtml(flow.name)}${flow.enabled ? "" : " (disabled)"}</option>`)
    .join("");
  return `
    <label class="block-param">
      <span>Flow</span>
      <select class="block-param-field" data-step-id="${action.id}" data-param="flowId" draggable="false">
        <option value="" ${selectedFlowId ? "" : "selected"}>Choose Flow</option>
        ${options}
      </select>
    </label>`;
}

function bindActionParamEditors() {
  $$(".block-param-field:not(.logic-param-field)").forEach((field) => {
    field.addEventListener("click", (event) => event.stopPropagation());
    field.addEventListener("dragstart", (event) => event.preventDefault());
    field.addEventListener("input", updateActionParamFromField);
    field.addEventListener("change", updateActionParamFromField);
  });
  $$(".create-preset-button").forEach((button) => {
    button.addEventListener("click", () => createPresetForAction(button.dataset.stepId));
  });
  $$(".variable-insert-select").forEach((select) => {
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", insertVariableAtCursor);
  });
  $$(".logic-param-field").forEach((field) => {
    field.addEventListener("input", updateLogicParamFromField);
    field.addEventListener("change", updateLogicParamFromField);
  });
  $$(".nested-add-select").forEach((select) => {
    select.addEventListener("change", handleNestedAdd);
  });
  $$(".add-random-branch").forEach((button) => {
    button.addEventListener("click", () => addRandomBranch(button.dataset.stepId));
  });
}

function updateActionParamFromField(event) {
  const draft = state.editorDraft;
  if (!draft) return;
  const action = findNode(draft, event.currentTarget.dataset.stepId);
  if (!action) return;
  const param = event.currentTarget.dataset.param;
  const rawValue = event.currentTarget.value;
  const actionType = action.actionId || action.type;

  if (actionType === "event.setVariable" && param === "valueType") {
    action.config.valueType = rawValue;
    action.config.value = rawValue === "boolean" ? true : rawValue === "number" ? 0 : "";
    draft.updatedAt = new Date().toISOString();
    updateUnsavedIndicator();
    renderFlowCanvas();
    return;
  }
  if (actionType === "event.setVariable" && param === "value") {
    const valueType = action.config.valueType || "string";
    action.config.value = valueType === "number" ? Number(rawValue) : valueType === "boolean" ? rawValue === "true" : rawValue;
  } else {
    action.config[param] = parseParamValue(actionType, param, rawValue, event.currentTarget.type);
  }
  draft.updatedAt = new Date().toISOString();
  updateUnsavedIndicator();
  const block = document.querySelector(`.flow-block[data-step-id="${action.id}"] .block-name`);
  if (block) block.textContent = describeStep(action);
}

function insertVariableAtCursor(event) {
  const name = event.currentTarget.value;
  if (!name) return;
  const stepId = event.currentTarget.dataset.stepId;
  const targetParam = event.currentTarget.dataset.targetParam;
  const field = document.querySelector(`.block-param-field[data-step-id="${stepId}"][data-param="${targetParam}"]`);
  event.currentTarget.value = "";
  if (!field) return;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const token = `{{${name}}}`;
  field.value = `${field.value.slice(0, start)}${token}${field.value.slice(end)}`;
  const cursor = start + token.length;
  field.focus();
  field.setSelectionRange(cursor, cursor);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function defaultConditionForFamily(family) {
  if (family === "variable") return { type: "variable.equals", variableName: "", compareType: "string", compareValue: "" };
  if (family === "execution") return { type: "execution.last-action-succeeded" };
  return { type: "app-running", target: { processName: "notepad.exe", displayName: "Notepad" } };
}

function updateLogicParamFromField(event) {
  const draft = state.editorDraft;
  if (!draft) return;
  const node = findNode(draft, event.currentTarget.dataset.stepId);
  if (!node) return;
  const param = event.currentTarget.dataset.param;
  const rawValue = event.currentTarget.value;

  if (param === "conditionFamily") {
    node.condition = defaultConditionForFamily(rawValue);
  } else if (param === "conditionType") {
    node.condition.type = rawValue;
    if (rawValue.startsWith("variable.")) {
      if (NUMBER_ONLY_CONDITIONS.has(rawValue)) {
        node.condition.compareType = "number";
        node.condition.compareValue = Number(node.condition.compareValue) || 0;
      } else if (rawValue === "variable.contains") {
        node.condition.compareType = "string";
        node.condition.compareValue = String(node.condition.compareValue ?? "");
      }
    }
  } else if (param === "processName") {
    node.condition.target = node.condition.target || {};
    node.condition.target.processName = rawValue;
    node.condition.target.displayName = rawValue.replace(/\.exe$/i, "") || "App";
  } else if (param === "variableName") {
    node.condition.variableName = rawValue;
  } else if (param === "compareType") {
    node.condition.compareType = rawValue;
    node.condition.compareValue = rawValue === "boolean" ? true : rawValue === "number" ? 0 : "";
  } else if (param === "compareValue") {
    const compareType = node.condition.compareType;
    node.condition.compareValue = compareType === "number" ? Number(rawValue) : compareType === "boolean" ? rawValue === "true" : rawValue;
  } else {
    node[param] = event.currentTarget.type === "number" ? Number(rawValue) : rawValue;
  }
  draft.updatedAt = new Date().toISOString();
  updateUnsavedIndicator();
  renderFlowCanvas();
}

function handleNestedAdd(event) {
  const commandId = event.currentTarget.value;
  if (!commandId) return;
  const draft = state.editorDraft;
  const parentId = event.currentTarget.dataset.parentId;
  const slot = event.currentTarget.dataset.slot;
  addStep(draft, commandId, 9999, { nodeId: parentId, slot });
  updateUnsavedIndicator();
  renderEditor();
}

function addRandomBranch(stepId) {
  const draft = state.editorDraft;
  const node = findNode(draft, stepId);
  if (!node || node.type !== "random-choice" || node.branches.length >= 10) return;
  node.branches.push([]);
  draft.updatedAt = new Date().toISOString();
  updateUnsavedIndicator();
  renderEditor();
}

function parseParamValue(actionType, param, rawValue, inputType) {
  if (inputType === "number") return Number(rawValue);
  if (actionType === "web.openMultiple" && param === "urls") {
    return rawValue.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
  }
  if (actionType === "pc.keyboardSequence" && param === "steps") {
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return rawValue;
    }
  }
  return rawValue;
}

async function createPresetForAction(stepId) {
  const draft = state.editorDraft;
  if (!draft) return;
  const action = findNode(draft, stepId);
  if (!action) return;
  const name = window.prompt("Preset name", "New Preset");
  if (!name) return;
  const text = window.prompt("Preset text", "");
  if (!text) return;
  try {
    const response = await window.swipey?.presets?.create?.({ name, text });
    if (!response?.success) throw new Error(response?.error?.message || "Preset could not be saved.");
    state.presets.unshift(response.preset);
    action.config.presetId = response.preset.id;
    updateUnsavedIndicator();
    renderFlowCanvas();
  } catch (error) {
    showToast(error.message);
  }
}

function insertionSlot(index) {
  return `<div class="insert-slot" data-index="${index}"><span></span></div>`;
}

function handleBlockAction(action, stepId) {
  const draft = state.editorDraft;
  if (!draft) return;
  const node = findNode(draft, stepId);
  if (!node) return;
  if (action === "delete") {
    const block = document.querySelector(`.flow-block[data-step-id="${stepId}"]`);
    block?.classList.add("removing");
    window.setTimeout(() => {
      removeStep(draft, stepId);
      renderEditor();
    }, 140);
    return;
  }
  if (action === "duplicate") {
    duplicateStep(draft, stepId);
  }
  updateUnsavedIndicator();
  renderEditor();
}

function renderTriggers() {
  $("#key-trigger-list").innerHTML = keyTriggers.length
    ? keyTriggers.map(renderKeyTrigger).join("")
    : `<div class="empty-state inline"><h2>No keys assigned</h2><p>Record a key to trigger a Flow.</p></div>`;
  $("#swipe-trigger-list").innerHTML = swipeTriggers.length
    ? swipeTriggers.map(renderSwipeTrigger).join("")
    : `<div class="empty-state inline"><h2>No swipes assigned</h2><p>Create a swipe to trigger a Flow.</p></div>`;
  bindTriggerSelects(keyTriggers, "#key-trigger-list");
  bindSwipeTriggerActions();
  bindKeyTriggerActions();
  updateCreateSwipeButton();
}

function bindKeyTriggerActions() {
  $$(".key-toggle").forEach((toggle) => {
    toggle.addEventListener("click", async (event) => {
      event.stopPropagation();
      const trigger = keyTriggers.find((item) => item.id === toggle.dataset.flowId);
      if (!trigger) return;
      try {
        const nextEnabled = !trigger.enabled;
        await setKeyTriggerEnabled(trigger.id, nextEnabled);
        renderAll();
        showToast(nextEnabled ? "Key binding enabled." : "Key binding disabled.");
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  $$(".key-delete-button").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await deleteKeyTrigger(button.dataset.keyId);
        renderAll();
        showToast("Key binding deleted.");
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function renderKeyTrigger(trigger) {
  const missingFlow = !findFlow(trigger.flowId);
  return `
    <div class="trigger-row ${trigger.enabled ? "" : "disabled"}" data-key-id="${trigger.id}">
      <span class="binding-source">${renderTriggerPreview(trigger)}${keyStatusText(trigger)}</span>
      <span class="flow-row-actions trigger-row-actions">
        ${missingFlow ? '<span class="no-trigger-text">Missing Flow</span>' : flowSelect(trigger)}
        ${renderToggle(trigger.enabled, `Key binding ${trigger.enabled ? "enabled" : "disabled"}`, "key-toggle", trigger.id)}
        <button class="icon-button key-delete-button" data-key-id="${trigger.id}" title="Delete key binding" type="button">${icon("delete")}</button>
      </span>
    </div>`;
}

function renderSwipeTrigger(trigger) {
  const missingFlow = !findFlow(trigger.flowId);
  return `
    <div class="trigger-row swipe-trigger-row ${trigger.enabled ? "" : "disabled"}" data-swipe-id="${trigger.id}">
      <span class="binding-source swipe-binding-source">${swipeEditor(trigger)}${swipeStatusText(trigger)}</span>
      <span class="flow-row-actions swipe-row-actions">
        ${missingFlow ? '<span class="no-trigger-text">Missing Flow</span>' : flowSelect(trigger)}
        ${renderToggle(trigger.enabled, `Swipe binding ${trigger.enabled ? "enabled" : "disabled"}`, "swipe-toggle", trigger.id)}
        <button class="icon-button swipe-delete-button" data-swipe-id="${trigger.id}" title="Delete swipe binding" type="button">${icon("delete")}</button>
      </span>
    </div>`;
}

function swipeEditor(trigger) {
  if (trigger.fingers !== 2) {
    return `
    <span class="trigger-preview swipe-preview">
      <span class="direction-tile">${escapeHtml(directionGlyph(trigger.direction))}</span>
      <span class="swipe-static-label">${escapeHtml(conciseSwipeLabel(trigger))}</span>
    </span>`;
  }
  return `
    <span class="trigger-preview swipe-preview">
      <span class="direction-tile">${escapeHtml(directionGlyph(trigger.direction))}</span>
      <select class="swipe-select swipe-direction" data-swipe-id="${trigger.id}" aria-label="Swipe direction">
        ${availableSwipeDirections(trigger).map((direction) => `<option value="${direction}" ${trigger.direction === direction ? "selected" : ""}>${directionLabel(direction)}</option>`).join("")}
      </select>
    </span>`;
}

function usedSwipeDirections(exceptId = "") {
  return new Set(
    swipeTriggers
      .filter((trigger) => trigger.id !== exceptId && Number(trigger.fingers) === 2)
      .map((trigger) => String(trigger.direction || "").toLowerCase())
      .filter((direction) => SWIPE_DIRECTIONS.includes(direction)),
  );
}

function availableSwipeDirections(trigger = null) {
  const current = String(trigger?.direction || "").toLowerCase();
  const used = usedSwipeDirections(trigger?.id || "");
  return SWIPE_DIRECTIONS.filter((direction) => direction === current || !used.has(direction));
}

function directionGlyph(direction) {
  return {
    down: "↓",
    left: "←",
    right: "→",
    up: "↑",
  }[String(direction || "").toLowerCase()] || "•";
}

function updateCreateSwipeButton() {
  const button = $("#create-swipe-trigger");
  if (!button) return;
  const canCreate = availableSwipeDirections().length > 0;
  button.disabled = !canCreate;
  button.title = canCreate ? "Create swipe binding" : "All swipe directions are assigned";
}

function flowSelect(trigger) {
  return `
    <select class="flow-select" data-trigger-id="${trigger.id}">
      ${flows.map((flow) => `<option value="${flow.id}" ${flow.id === trigger.flowId ? "selected" : ""}>${escapeHtml(flow.name)}</option>`).join("")}
    </select>`;
}

function bindTriggerSelects(collection, rootSelector) {
  $$(`${rootSelector} .flow-select`).forEach((select) => {
    select.addEventListener("change", async () => {
      const trigger = collection.find((item) => item.id === select.dataset.triggerId);
      if (!trigger) return;
      if (trigger.type === "key") {
        try {
          await updateKeyTrigger({ ...trigger, flowId: select.value });
          renderAll();
          showToast("Key binding updated.");
        } catch (error) {
          showToast(error.message);
          renderAll();
        }
        return;
      }
    });
  });
}

function bindSwipeTriggerActions() {
  $$("#swipe-trigger-list .flow-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const trigger = swipeTriggers.find((item) => item.id === select.dataset.triggerId);
      if (!trigger) return;
      try {
        await updateSwipeTrigger({ ...trigger, flowId: select.value });
        renderAll();
      } catch (error) {
        showToast(error.message);
        renderAll();
      }
    });
  });
  $$("#swipe-trigger-list .swipe-direction").forEach((select) => {
    select.addEventListener("change", async () => {
      const trigger = swipeTriggers.find((item) => item.id === select.dataset.swipeId);
      if (!trigger) return;
      const fingers = 2;
      const direction = select.value;
      try {
        await updateSwipeTrigger({ ...trigger, fingers, direction });
        renderAll();
      } catch (error) {
        showToast(error.message);
        renderAll();
      }
    });
  });
  $$(".swipe-toggle").forEach((toggle) => {
    toggle.addEventListener("click", async (event) => {
      event.stopPropagation();
      const trigger = swipeTriggers.find((item) => item.id === toggle.dataset.flowId);
      if (!trigger) return;
      try {
        const nextEnabled = !trigger.enabled;
        await setSwipeTriggerEnabled(trigger.id, nextEnabled);
        renderAll();
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  $$(".swipe-delete-button").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await deleteSwipeTrigger(button.dataset.swipeId);
        renderAll();
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function keyStatusText(trigger) {
  if (trigger.status === "registered" || trigger.status === "ready" || trigger.status === "disabled") return "";
  const text = trigger.statusReason || trigger.status;
  return `<span class="no-trigger-text">${escapeHtml(text)}</span>`;
}

function swipeStatusText(trigger) {
  if (trigger.status === "registered" || trigger.status === "disabled") return "";
  const text = trigger.statusReason || trigger.status;
  return `<span class="no-trigger-text">${escapeHtml(text)}</span>`;
}

function renderSwipeModeState() {
  const toggle = $("#swipes-master-toggle");
  const status = $("#swipes-mode-status");
  if (!toggle || !status) return;

  toggle.classList.toggle("is-on", state.swipesEnabled);
  toggle.disabled = state.swipeModeBusy;
  toggle.setAttribute("aria-checked", String(state.swipesEnabled));
  toggle.setAttribute("aria-label", state.swipesEnabled ? "Swipes enabled" : "Swipes disabled");

  const windowsStatus = state.swipeModeStatus?.windowsTouchpad;
  const lastApply = windowsStatus?.lastApplyResult;
  const lastRestore = windowsStatus?.lastRestoreResult;
  const capability = windowsStatus?.capabilities;
  let message = "";

  if (state.swipesEnabled && lastApply && !lastApply.success) message = "Windows touchpad gestures could not be fully disabled.";
  else if (!state.swipesEnabled && state.swipeModeStatus?.hasOriginalWindowsTouchpadSettings && lastRestore && !lastRestore.success) message = "Windows touchpad settings restoration needs another attempt.";
  else if (state.swipesEnabled && capability && capability.supported === false) message = "Windows touchpad settings could not be fully configured.";

  status.textContent = message;
  status.classList.toggle("warning", !!message);
}

function renderAll() {
  renderFlowsOverview();
  renderTriggers();
  renderSwipeModeState();
  hydrateIcons();
}

async function loadPresets() {
  const response = await window.swipey?.presets?.list?.();
  if (!response?.success) throw new Error(response?.error?.message || "Unable to load presets.");
  state.presets = Array.isArray(response.presets) ? response.presets : [];
}

function wireEvents() {
  $$(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      requestNavigation(() => {
        state.editorDraft = null;
        state.editorBaselineSnapshot = null;
        switchView(item.dataset.view);
        renderAll();
      });
    });
  });

  $("#create-flow").addEventListener("click", openTemplatePickerDialog);
  $("#template-start-blank").addEventListener("click", startBlankFlow);
  $("#template-picker-cancel").addEventListener("click", closeTemplatePickerDialog);
  $("#flow-search").addEventListener("input", (event) => {
    state.flowSearchQuery = event.target.value;
    renderFlowsOverview();
  });
  $$("#flow-filter .segmented-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.flowFilter = button.dataset.filter;
      updateFlowFilterButtons();
      renderFlowsOverview();
    });
  });
  $("#editor-back").addEventListener("click", () => requestNavigation(closeEditor));
  $("#editor-cancel").addEventListener("click", () => requestNavigation(closeEditor));
  $("#editor-save").addEventListener("click", saveEditor);
  $("#editor-run").addEventListener("click", runEditorFlow);
  $("#editor-flow-name").addEventListener("input", (event) => {
    if (!state.editorDraft) return;
    state.editorDraft.name = event.target.value.trimStart() || "Untitled Flow";
    updateUnsavedIndicator();
  });

  $("#editor-flow-name").addEventListener("focus", (event) => {
    state.titleBeforeEdit = event.currentTarget.value;
  });
  $("#editor-flow-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      event.stopPropagation();
      const restored = state.titleBeforeEdit || "Untitled Flow";
      event.currentTarget.value = restored;
      if (state.editorDraft) state.editorDraft.name = restored;
      updateUnsavedIndicator();
      event.currentTarget.blur();
    }
  });

  $("#create-key-trigger").addEventListener("click", toggleKeyRecording);
  $("#create-swipe-trigger").addEventListener("click", createDefaultSwipeBinding);
  $("#swipes-master-toggle").addEventListener("click", toggleMasterSwipes);

  $("#win-minimize").addEventListener("click", () => window.swipey?.windowMinimize?.());
  $("#win-maximize").addEventListener("click", () => window.swipey?.windowMaximizeToggle?.());
  $("#win-close").addEventListener("click", () => requestNavigation(() => window.swipey?.windowClose?.()));
  window.swipey?.onWindowStateChanged?.(({ maximized }) => {
    $("#win-maximize .icon").innerHTML = icon(maximized ? "copy" : "maximize");
  });
  window.swipey?.keys?.onFlowResult?.(({ binding, result }) => {
    if (result?.success) showToast(`${binding.displayName} completed ${result.flowName}.`);
    else showToast(result?.message || `${binding.displayName} failed.`);
  });
  window.swipey?.swipes?.onFlowResult?.(({ binding, result }) => {
    if (result?.success) showToast(`${binding.displayName} completed ${result.flowName}.`);
    else showToast(result?.message || `${binding.displayName} failed.`);
  });
  window.swipey?.swipes?.onModeChanged?.((mode) => {
    state.swipesEnabled = !!mode?.swipesEnabled;
    state.swipeModeStatus = mode;
    renderSwipeModeState();
  });

  document.addEventListener("click", (event) => {
    if (!$("#flow-context-menu").contains(event.target)) closeContextMenu();
  });
  $("#dialog-stay").addEventListener("click", closeUnsavedDialog);
  $("#dialog-leave").addEventListener("click", leaveWithoutSaving);
  window.addEventListener("keydown", (event) => {
    if (state.recordingKey) {
      handleKeyRecordingEvent(event);
      return;
    }
    if (event.key === "Escape" && state.dialogOpen) {
      event.preventDefault();
      closeUnsavedDialog();
      closeTemplatePickerDialog();
    } else if (event.key === "Escape" && state.activeView === "flow-editor") requestNavigation(closeEditor);
    else if (event.key === "Escape") closeContextMenu();
  });
}

async function toggleMasterSwipes() {
  if (state.swipeModeBusy) return;
  const nextEnabled = !state.swipesEnabled;
  state.swipeModeBusy = true;
  renderSwipeModeState();
  try {
    const response = await window.swipey?.swipes?.setModeEnabled?.(nextEnabled);
    if (!response?.success) throw new Error(response?.error?.message || "Unable to update Swipes.");
    const mode = response.state || response.mode;
    state.swipesEnabled = !!mode?.swipesEnabled;
    state.swipeModeStatus = mode;
    renderSwipeModeState();
    const windowsResult = response.windows;
    if (nextEnabled && windowsResult && !windowsResult.success) showToast("Windows touchpad gestures could not be fully disabled.");
    else if (!nextEnabled && windowsResult && !windowsResult.success) showToast("Windows settings restoration will be retried later.");
  } catch (error) {
    showToast(error.message);
  } finally {
    state.swipeModeBusy = false;
    renderSwipeModeState();
  }
}

async function createDefaultSwipeBinding() {
  if (flows.length === 0) {
    showToast("Create a Flow before assigning a Swipe.");
    return;
  }
  const direction = availableSwipeDirections()[0];
  if (!direction) return;
  try {
    await createSwipeTrigger({ type: "swipe", fingers: 2, direction, flowId: flows[0].id, enabled: true });
    renderAll();
  } catch (error) {
    showToast(error.message);
  }
}

async function toggleKeyRecording() {
  if (state.recordingKey) {
    await cancelKeyRecording("Key recording cancelled.");
    return;
  }
  if (flows.length === 0) {
    showToast("Create a Flow before recording a Key.");
    return;
  }
  state.recordingKey = true;
  state.recordingStartedAt = Date.now();
  updateRecordKeyButton();
  window.clearTimeout(toggleKeyRecording.timer);
  // Die Aufnahme bricht nach 30 Sekunden ab, falls nichts gedrückt wird.
  toggleKeyRecording.timer = window.setTimeout(() => cancelKeyRecording("Key recording timed out."), 30000);
}

async function cancelKeyRecording(message = "") {
  state.recordingKey = false;
  state.recordingStartedAt = null;
  window.clearTimeout(toggleKeyRecording.timer);
  updateRecordKeyButton();
  if (message) showToast(message);
}

async function handleKeyRecordingEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    await cancelKeyRecording("Key recording cancelled.");
    return;
  }
  if (isModifierRecordingKey(event.code)) return;

  const binding = recordedBindingFromEvent(event);
  try {
    const saved = await createKeyTrigger(binding);
    await cancelKeyRecording("");
    renderAll();
    showToast(saved.commonTyping ? `${saved.displayName} recorded. This key may trigger while typing.` : `${saved.displayName} recorded.`);
  } catch (error) {
    await cancelKeyRecording("");
    showToast(error.message);
  }
}

function updateRecordKeyButton() {
  const button = $("#create-key-trigger");
  button.classList.toggle("is-recording", state.recordingKey);
  button.innerHTML = state.recordingKey
    ? `<span class="record-dot"></span><span>Press a key combination...</span>`
    : `<span class="icon" data-icon="keyboard"></span><span>Record Key</span>`;
  hydrateIcons(button);
}

function recordedBindingFromEvent(event) {
  return {
    type: "key",
    flowId: flows[0]?.id,
    enabled: true,
    input: {
      code: event.code,
      key: event.key,
      location: keyLocationName(event.location),
      displayName: event.code,
    },
    modifiers: {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      win: event.metaKey,
      left: {},
      right: {},
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function keyLocationName(location) {
  if (location === KeyboardEvent.DOM_KEY_LOCATION_NUMPAD) return "numpad";
  if (location === KeyboardEvent.DOM_KEY_LOCATION_LEFT) return "left";
  if (location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT) return "right";
  return "standard";
}

function isModifierRecordingKey(code) {
  return ["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(code);
}

async function boot() {
  hydrateIcons();
  wireEvents();
  // Die Version kommt aus der package.json, damit sie nur an einer Stelle gepflegt wird.
  window.swipey?.getVersion?.().then((version) => {
    $("#app-version").textContent = `Version ${version}`;
  });
  try {
    const modeResponse = await window.swipey?.swipes?.getMode?.();
    if (modeResponse?.success) {
      state.swipesEnabled = !!modeResponse.mode?.swipesEnabled;
      state.swipeModeStatus = modeResponse.mode;
    }
    await loadFlows();
    await loadPresets();
    await loadKeyTriggers();
    await loadSwipeTriggers();
  } catch (error) {
    console.error("[boot] Failed to load persisted state", error);
    showToast(`Could not load saved state: ${error.message}`);
  }
  renderAll();
}

boot();

