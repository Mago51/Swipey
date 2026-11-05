import { findCommand } from "../commands/catalog.js";

export const flows = [];

const createId = (prefix) => {
  const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}_${id}`;
};

export async function loadFlows() {
  const response = await window.swipey?.flows?.list?.();
  if (!response?.success) throw new Error(response?.error?.message || "Unable to load Flows.");
  replaceFlows(response.flows.map(normalizeFlow));
  return flows;
}

export function createFlowDraft() {
  const now = new Date().toISOString();
  return { id: createId("flow"), name: "Untitled Flow", enabled: true, nodes: [], actions: [], createdAt: now, updatedAt: now };
}

export function createDraftFromTemplate(template) {
  return normalizeFlow({
    id: createId("flow"),
    name: template.flow.name,
    enabled: true,
    actions: template.flow.actions || [],
  });
}

export function cloneFlow(flow) {
  const normalized = normalizeFlow(flow);
  return {
    ...normalized,
    nodes: cloneNodes(normalized.nodes),
    actions: topLevelActions(normalized.nodes),
  };
}

export async function saveFlowDraft(draft) {
  syncActions(draft);
  const existing = flows.some((flow) => flow.id === draft.id);
  const response = existing ? await window.swipey.flows.update(cloneFlow(draft)) : await window.swipey.flows.create(cloneFlow(draft));
  if (!response?.success) throw ipcError(response, "Unable to save Flow.");
  upsertLocalFlow(response.flow);
  return findFlow(response.flow.id);
}

export async function duplicateFlow(flow) {
  const response = await window.swipey.flows.duplicate(flow.id);
  if (!response?.success) throw ipcError(response, "Unable to duplicate Flow.");
  flows.unshift(normalizeFlow(response.flow));
  return findFlow(response.flow.id);
}

function ipcError(response, fallbackMessage) {
  const error = new Error(response?.error?.message || fallbackMessage);
  error.code = response?.error?.code || null;
  return error;
}

export async function deleteFlow(flowId) {
  const response = await window.swipey.flows.delete(flowId);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to delete Flow.");
  const index = flows.findIndex((flow) => flow.id === flowId);
  if (index >= 0) flows.splice(index, 1);
}

export async function setFlowEnabled(flowId, enabled) {
  const response = await window.swipey.flows.setEnabled(flowId, enabled);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to update Flow.");
  upsertLocalFlow(response.flow);
  return findFlow(response.flow.id);
}

export function findFlow(flowId) {
  return flows.find((flow) => flow.id === flowId) ?? null;
}

export function addStep(flow, commandId, index = flow.nodes.length, target = null) {
  const command = findCommand(commandId);
  if (!command) return null;
  const node = createNodeForCommand(command);
  const list = target ? getNodeList(flow, target) : flow.nodes;
  if (!list) return null;
  list.splice(index, 0, node);
  touch(flow);
  return node;
}

export function removeStep(flow, nodeId) {
  removeNodeFromList(flow.nodes, nodeId);
  touch(flow);
}

export function duplicateStep(flow, nodeId) {
  const located = findNodeLocation(flow.nodes, nodeId);
  if (!located) return null;
  const copy = cloneNodeWithNewIds(located.node);
  located.list.splice(located.index + 1, 0, copy);
  touch(flow);
  return copy;
}

export function moveStep(flow, fromIndex, toIndex) {
  const [node] = flow.nodes.splice(fromIndex, 1);
  flow.nodes.splice(toIndex, 0, node);
  touch(flow);
}

export function findNode(flow, nodeId) {
  return findNodeLocation(flow.nodes || [], nodeId)?.node || null;
}

export function describeStep(node) {
  if (node.type !== "action") return describeContainer(node);
  const command = findCommand(node.actionId);
  const params = node.config || {};
  if (!command) return "Unknown Command";
  if (node.actionId === "event.wait") return `Wait ${params.milliseconds}ms`;
  if (node.actionId === "app.open") return `Open ${params.path}`;
  if (node.actionId === "app.close") return `Close ${params.processName}`;
  if (node.actionId === "app.focus") return `Focus ${params.displayName || params.processName || "App"}`;
  if (node.actionId === "app.minimize") return `Minimize ${params.displayName || params.processName || "App"}`;
  if (node.actionId === "app.maximize") return `Maximize ${params.displayName || params.processName || "App"}`;
  if (node.actionId === "app.moveToPosition") return `Move ${params.displayName || params.processName || "App"} -> ${positionLabel(params.position)}`;
  if (node.actionId === "app.waitUntilOpens") return `Wait for ${params.displayName || params.processName || "App"} - ${Math.round(Number(params.timeoutMs || 30000) / 1000)}s`;
  if (node.actionId === "web.openWebsite") return `Open ${params.url}`;
  if (node.actionId === "web.searchGoogle") return `Search Google for ${params.query}`;
  if (node.actionId === "web.searchYouTube") return `Search YouTube for ${params.query}`;
  if (node.actionId === "web.openClipboardUrl") return "Open clipboard URL";
  if (node.actionId === "web.openInBrowser") return `${hostFromUrl(params.url)} - ${browserLabel(params.browserId)}`;
  if (node.actionId === "web.openMultiple") return `${Array.isArray(params.urls) ? params.urls.length : 0} websites - ${browserLabel(params.browserId || "default")}`;
  if (node.actionId === "event.runFlow") return `Run ${findFlow(params.flowId)?.name || "Flow"}`;
  if (node.actionId === "event.stopFlow") return "Stop Flow";
  if (node.actionId === "pc.typeText") return `Type ${params.text || "text"}`;
  if (node.actionId === "pc.pressKey") return `Press ${params.key || "key"}`;
  if (node.actionId === "pc.pressKeyCombination") return `Press ${params.combination || "keys"}`;
  if (node.actionId === "pc.setVolume") return `Set Volume ${params.percent}%`;
  if (node.actionId === "pc.pastePresetText") return `Paste ${params.presetName || "Preset Text"}`;
  if (node.actionId === "pc.keyboardSequence") return `${Array.isArray(params.steps) ? params.steps.length : 0} steps`;
  if (node.actionId === "event.setVariable") return `${params.name || "variable"} = ${formatVariableValue(params.valueType, params.value)}`;
  if (node.actionId === "event.incrementVariable") return `${params.name || "variable"} += ${params.amount ?? 1}`;
  if (node.actionId === "event.decrementVariable") return `${params.name || "variable"} -= ${params.amount ?? 1}`;
  if (node.actionId === "event.stopWithError") return `Stop Flow with Error: ${params.message || ""}`;
  return command.label;
}

function formatVariableValue(valueType, value) {
  if (valueType === "string") return `"${value ?? ""}"`;
  return String(value ?? "");
}

export function actionCount(flow) {
  return countActionNodes(normalizeFlow(flow).nodes);
}

function createNodeForCommand(command) {
  if (command.nodeKind === "repeat") return { id: createId("node"), type: "repeat", count: Number(command.defaultConfig?.count || 3), children: [] };
  if (command.nodeKind === "if") return { id: createId("node"), type: "if", condition: cloneCondition(command.defaultConfig?.condition), then: [], else: [] };
  if (command.nodeKind === "wait-until") return { id: createId("node"), type: "wait-until", condition: cloneCondition(command.defaultConfig?.condition), timeoutMs: Number(command.defaultConfig?.timeoutMs || 30000), pollIntervalMs: Number(command.defaultConfig?.pollIntervalMs || 500) };
  if (command.nodeKind === "delay-between-actions") return { id: createId("node"), type: "delay-between-actions", delayMs: Number(command.defaultConfig?.delayMs || 250), children: [] };
  if (command.nodeKind === "run-after-delay") return { id: createId("node"), type: "run-after-delay", delayMs: Number(command.defaultConfig?.delayMs || 5000), children: [] };
  if (command.nodeKind === "random-choice") return { id: createId("node"), type: "random-choice", branches: [[], []] };
  if (command.nodeKind === "try") return { id: createId("node"), type: "try", children: [], onError: [] };
  if (command.nodeKind === "continue-on-error") return { id: createId("node"), type: "continue-on-error", children: [] };
  return { id: createId("node"), type: "action", actionId: command.id, config: { ...command.defaultConfig } };
}

function getNodeList(flow, target) {
  const parent = findNode(flow, target.nodeId);
  if (!parent) return null;
  if (target.slot === "children") return parent.children;
  if (target.slot === "then") return parent.then;
  if (target.slot === "else") return parent.else;
  if (target.slot === "onError") return parent.onError;
  if (target.slot?.startsWith("branch:")) return parent.branches?.[Number(target.slot.split(":")[1])];
  return null;
}

function describeContainer(node) {
  if (node.type === "repeat") return `Repeat ${node.count} times`;
  if (node.type === "if") return `If ${conditionLabel(node.condition)}`;
  if (node.type === "wait-until") return `Wait Until ${conditionLabel(node.condition)}`;
  if (node.type === "delay-between-actions") return `Delay Between Actions ${node.delayMs}ms`;
  if (node.type === "run-after-delay") return `Run After Delay ${node.delayMs}ms`;
  if (node.type === "random-choice") return "Random Choice";
  if (node.type === "try") return "Try / On Error";
  if (node.type === "continue-on-error") return "Continue On Error";
  return "Logic";
}

const VARIABLE_CONDITION_LABELS = {
  "variable.equals": (name, value) => `${name} == ${value}`,
  "variable.not-equals": (name, value) => `${name} != ${value}`,
  "variable.greater-than": (name, value) => `${name} > ${value}`,
  "variable.greater-or-equal": (name, value) => `${name} >= ${value}`,
  "variable.less-than": (name, value) => `${name} < ${value}`,
  "variable.less-or-equal": (name, value) => `${name} <= ${value}`,
  "variable.contains": (name, value) => `${name} contains ${value}`,
  "variable.is-true": (name) => `${name} is true`,
  "variable.is-false": (name) => `${name} is false`,
  "variable.exists": (name) => `${name} exists`,
};

function conditionLabel(condition) {
  const type = condition?.type || "";
  if (type.startsWith("variable.")) {
    const name = condition.variableName || "variable";
    const value = condition.compareType === "string" ? `"${condition.compareValue}"` : String(condition.compareValue);
    return (VARIABLE_CONDITION_LABELS[type] || (() => `${name} condition`))(name, value);
  }
  if (type === "execution.last-action-succeeded") return "last action succeeded";
  if (type === "execution.last-action-failed") return "last action failed";
  const target = condition?.target || {};
  const name = target.displayName || target.processName || "App";
  return type === "app-not-running" ? `${name} is not running` : `${name} is running`;
}

function normalizeFlow(flow) {
  const now = new Date().toISOString();
  const nodes = Array.isArray(flow.nodes) ? normalizeNodes(flow.nodes) : normalizeActions(flow.actions || flow.steps || []);
  return {
    id: String(flow.id),
    name: String(flow.name || "Untitled Flow"),
    enabled: typeof flow.enabled === "boolean" ? flow.enabled : true,
    nodes,
    actions: topLevelActions(nodes),
    createdAt: typeof flow.createdAt === "string" ? flow.createdAt : now,
    updatedAt: typeof flow.updatedAt === "string" ? flow.updatedAt : now,
  };
}

function normalizeActions(actions) {
  return actions.map((action) => ({
    id: String(action.id || createId("node")),
    type: "action",
    actionId: action.type || action.commandId,
    config: { ...(action.params || action.config || {}) },
  }));
}

function normalizeNodes(nodes) {
  return nodes.map((node) => {
    if (node.type === "action" || node.actionId) return { id: String(node.id || createId("node")), type: "action", actionId: node.actionId || node.type, config: { ...(node.config || node.params || {}) } };
    if (node.type === "repeat") return { id: String(node.id || createId("node")), type: "repeat", count: Number(node.count || 1), children: normalizeNodes(node.children || []) };
    if (node.type === "if") return { id: String(node.id || createId("node")), type: "if", condition: cloneCondition(node.condition), then: normalizeNodes(node.then || []), else: normalizeNodes(node.else || []) };
    if (node.type === "wait-until") return { id: String(node.id || createId("node")), type: "wait-until", condition: cloneCondition(node.condition), timeoutMs: Number(node.timeoutMs || 30000), pollIntervalMs: Number(node.pollIntervalMs || 500) };
    if (node.type === "delay-between-actions") return { id: String(node.id || createId("node")), type: "delay-between-actions", delayMs: Number(node.delayMs || 250), children: normalizeNodes(node.children || []) };
    if (node.type === "run-after-delay") return { id: String(node.id || createId("node")), type: "run-after-delay", delayMs: Number(node.delayMs || 5000), children: normalizeNodes(node.children || []) };
    if (node.type === "random-choice") return { id: String(node.id || createId("node")), type: "random-choice", branches: (node.branches || [[], []]).map(normalizeNodes) };
    if (node.type === "try") return { id: String(node.id || createId("node")), type: "try", children: normalizeNodes(node.children || []), onError: normalizeNodes(node.onError || []) };
    if (node.type === "continue-on-error") return { id: String(node.id || createId("node")), type: "continue-on-error", children: normalizeNodes(node.children || []) };
    return { ...node, id: String(node.id || createId("node")) };
  });
}

function cloneNodes(nodes) {
  return nodes.map((node) => {
    if (node.type === "action") return { ...node, config: { ...node.config } };
    if (node.type === "repeat") return { ...node, children: cloneNodes(node.children) };
    if (node.type === "if") return { ...node, condition: cloneCondition(node.condition), then: cloneNodes(node.then), else: cloneNodes(node.else) };
    if (node.type === "wait-until") return { ...node, condition: cloneCondition(node.condition) };
    if (node.type === "delay-between-actions" || node.type === "run-after-delay") return { ...node, children: cloneNodes(node.children) };
    if (node.type === "random-choice") return { ...node, branches: node.branches.map(cloneNodes) };
    if (node.type === "try") return { ...node, children: cloneNodes(node.children), onError: cloneNodes(node.onError) };
    if (node.type === "continue-on-error") return { ...node, children: cloneNodes(node.children) };
    return { ...node };
  });
}

function cloneNodeWithNewIds(node) {
  const copy = cloneNodes([node])[0];
  assignNewIds(copy);
  return copy;
}

function assignNewIds(node) {
  node.id = createId("node");
  if (node.children) node.children.forEach(assignNewIds);
  if (node.then) node.then.forEach(assignNewIds);
  if (node.else) node.else.forEach(assignNewIds);
  if (node.onError) node.onError.forEach(assignNewIds);
  if (node.branches) node.branches.flat().forEach(assignNewIds);
}

function cloneCondition(condition) {
  const type = condition?.type || "app-running";
  if (type.startsWith("variable.")) {
    return {
      type,
      variableName: condition.variableName || "",
      compareType: condition.compareType || "string",
      compareValue: condition.compareValue ?? "",
    };
  }
  if (type.startsWith("execution.")) return { type };
  return {
    type,
    target: { ...(condition?.target || { processName: "notepad.exe", displayName: "Notepad" }) },
  };
}

function removeNodeFromList(nodes, nodeId) {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index >= 0) {
    nodes.splice(index, 1);
    return true;
  }
  for (const node of nodes) {
    if (node.children && removeNodeFromList(node.children, nodeId)) return true;
    if (node.then && removeNodeFromList(node.then, nodeId)) return true;
    if (node.else && removeNodeFromList(node.else, nodeId)) return true;
    if (node.onError && removeNodeFromList(node.onError, nodeId)) return true;
    if (node.branches?.some((branch) => removeNodeFromList(branch, nodeId))) return true;
  }
  return false;
}

function findNodeLocation(nodes, nodeId) {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index >= 0) return { node: nodes[index], list: nodes, index };
  for (const node of nodes) {
    for (const list of [node.children, node.then, node.else, node.onError, ...(node.branches || [])].filter(Boolean)) {
      const found = findNodeLocation(list, nodeId);
      if (found) return found;
    }
  }
  return null;
}

function topLevelActions(nodes) {
  return nodes.filter((node) => node.type === "action").map((node) => ({ id: node.id, type: node.actionId, params: { ...node.config } }));
}

function syncActions(flow) {
  flow.actions = topLevelActions(flow.nodes || []);
}

function touch(flow) {
  syncActions(flow);
  flow.updatedAt = new Date().toISOString();
}

function countActionNodes(nodes) {
  return nodes.reduce((count, node) => {
    if (node.type === "action") return count + 1;
    if (node.children) count += countActionNodes(node.children);
    if (node.then) count += countActionNodes(node.then);
    if (node.else) count += countActionNodes(node.else);
    if (node.onError) count += countActionNodes(node.onError);
    if (node.branches) count += node.branches.reduce((branchCount, branch) => branchCount + countActionNodes(branch), 0);
    return count;
  }, 0);
}

function replaceFlows(nextFlows) {
  flows.splice(0, flows.length, ...nextFlows);
}

function upsertLocalFlow(flow) {
  const normalized = normalizeFlow(flow);
  const index = flows.findIndex((item) => item.id === normalized.id);
  if (index >= 0) flows.splice(index, 1, normalized);
  else flows.unshift(normalized);
}

function positionLabel(position) {
  return String(position || "").split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function browserLabel(browserId) {
  return { default: "Default", edge: "Edge", chrome: "Chrome", firefox: "Firefox", brave: "Brave", opera: "Opera" }[browserId] || "Browser";
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch (_error) {
    return value || "Website";
  }
}
