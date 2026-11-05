import { appCommands } from "./apps.js";
import { webCommands } from "./web.js";
import { eventCommands } from "./events.js";
import { pcCommands } from "./pc.js";

export const commandCategories = [
  { id: "apps", label: "Apps", description: "Application actions", icon: "window", colorToken: "app", commands: appCommands },
  { id: "web", label: "Web", description: "Browser and websites", icon: "globe", colorToken: "web", commands: webCommands },
  { id: "events", label: "Events", description: "Timing and flow control", icon: "clock", colorToken: "event", commands: eventCommands },
  { id: "pc", label: "PC", description: "Windows system controls", icon: "monitor", colorToken: "pc", commands: pcCommands },
];

export const legacyCommandIds = {
  "open-app": "app.open",
  "close-app": "app.close",
  "focus-app": "app.focus",
  "minimize-app": "app.minimize",
  "maximize-app": "app.maximize",
  "move-app-to-position": "app.moveToPosition",
  "wait-until-app-opens": "app.waitUntilOpens",
  "if-app-running": "app.ifRunning",
  "if-app-not-running": "app.ifNotRunning",
  wait: "event.wait",
  "run-flow": "event.runFlow",
  "stop-flow": "event.stopFlow",
  repeat: "event.loop",
  "if-else": "event.condition",
  "random-choice": "event.randomChoice",
  "delay-between-actions": "event.delayBetweenActions",
  "run-after-delay": "event.runAfterDelay",
  "wait-until": "event.waitUntil",
  "set-variable": "event.setVariable",
  "increment-variable": "event.incrementVariable",
  "decrement-variable": "event.decrementVariable",
  try: "event.try",
  "continue-on-error": "event.continueOnError",
  "stop-with-error": "event.stopWithError",
  "lock-pc": "pc.lock",
  "show-desktop": "pc.showDesktop",
  "open-explorer": "pc.openExplorer",
  "open-terminal": "pc.openTerminal",
  "open-task-manager": "pc.openTaskManager",
  "open-settings": "pc.openSettings",
  "volume-up": "pc.volumeUp",
  "volume-down": "pc.volumeDown",
  mute: "pc.mute",
  "play-pause": "pc.mediaPlayPause",
  "next-track": "pc.mediaNext",
  "previous-track": "pc.mediaPrevious",
  screenshot: "pc.screenshot",
  copy: "pc.copy",
  paste: "pc.paste",
  undo: "pc.undo",
  redo: "pc.redo",
  "select-all": "pc.selectAll",
  "type-text": "pc.typeText",
  "press-key": "pc.pressKey",
  "press-key-combination": "pc.pressKeyCombination",
  "set-volume": "pc.setVolume",
  "paste-preset-text": "pc.pastePresetText",
  "keyboard-sequence": "pc.keyboardSequence",
  "open-website": "web.openWebsite",
  "search-google": "web.searchGoogle",
  "search-web": "web.searchGoogle",
  "youtube-search": "web.searchYouTube",
  "open-clipboard-url": "web.openClipboardUrl",
  "open-in-browser": "web.openInBrowser",
  "open-multiple-websites": "web.openMultiple",
};

export const commands = commandCategories.flatMap((category) =>
  category.commands.map((command) => ({
    ...command,
    categoryId: category.id,
    categoryLabel: category.label,
    colorToken: category.colorToken,
  }))
);

export function resolveCommandId(commandId) {
  return legacyCommandIds[commandId] || commandId;
}

export function findCommand(commandId) {
  const resolvedId = resolveCommandId(commandId);
  return commands.find((command) => command.id === resolvedId);
}
