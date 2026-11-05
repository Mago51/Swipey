export const swipeTriggers = [];

export async function loadSwipeTriggers() {
  const response = await window.swipey?.swipes?.list?.();
  if (!response?.success) throw new Error(response?.error?.message || "Unable to load Swipe bindings.");
  replaceBindings(response.bindings);
  return swipeTriggers;
}

export async function createSwipeTrigger(binding) {
  const response = await window.swipey.swipes.create(binding);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to create Swipe binding.");
  swipeTriggers.unshift(response.binding);
  return response.binding;
}

export async function updateSwipeTrigger(binding) {
  const response = await window.swipey.swipes.update(binding);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to update Swipe binding.");
  upsertBinding(response.binding);
  return response.binding;
}

export async function deleteSwipeTrigger(id) {
  const response = await window.swipey.swipes.delete(id);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to delete Swipe binding.");
  const index = swipeTriggers.findIndex((binding) => binding.id === id);
  if (index >= 0) swipeTriggers.splice(index, 1);
}

export async function setSwipeTriggerEnabled(id, enabled) {
  const response = await window.swipey.swipes.setEnabled(id, enabled);
  if (!response?.success) throw new Error(response?.error?.message || "Unable to update Swipe binding.");
  upsertBinding(response.binding);
  return response.binding;
}

function replaceBindings(bindings) {
  swipeTriggers.splice(0, swipeTriggers.length, ...(bindings || []));
}

function upsertBinding(binding) {
  const index = swipeTriggers.findIndex((item) => item.id === binding.id);
  if (index >= 0) swipeTriggers.splice(index, 1, binding);
  else swipeTriggers.unshift(binding);
}
