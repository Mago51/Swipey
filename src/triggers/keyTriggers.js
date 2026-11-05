export const keyTriggers = [];

export async function loadKeyTriggers() {
  const response = await window.swipey?.keys?.list?.();
  if (!response?.success) throw new Error(response?.error?.message || "Unable to load Key bindings.");
  replaceBindings(response.bindings);
  return keyTriggers;
}

export async function createKeyTrigger(binding) {
  const response = await window.swipey.keys.create(binding);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to create Key binding.");
  keyTriggers.unshift(response.binding);
  return response.binding;
}

export async function updateKeyTrigger(binding) {
  const response = await window.swipey.keys.update(binding);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to update Key binding.");
  upsertBinding(response.binding);
  return response.binding;
}

export async function deleteKeyTrigger(id) {
  const response = await window.swipey.keys.delete(id);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to delete Key binding.");
  const index = keyTriggers.findIndex((binding) => binding.id === id);
  if (index >= 0) keyTriggers.splice(index, 1);
}

export async function setKeyTriggerEnabled(id, enabled) {
  const response = await window.swipey.keys.setEnabled(id, enabled);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to update Key binding.");
  upsertBinding(response.binding);
  return response.binding;
}

function replaceBindings(bindings) {
  keyTriggers.splice(0, keyTriggers.length, ...(bindings || []));
}

function upsertBinding(binding) {
  const index = keyTriggers.findIndex((item) => item.id === binding.id);
  if (index >= 0) keyTriggers.splice(index, 1, binding);
  else keyTriggers.unshift(binding);
}
