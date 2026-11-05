import { findCommand } from "./catalog.js";

export const flowTemplates = [
  {
    id: "focus-mode",
    name: "Focus Mode",
    description: "Silence notifications, clear your desktop, and open a blank notes app to focus.",
    category: "Productivity",
    flow: {
      name: "Focus Mode",
      actions: [
        { type: "pc.mute", params: {} },
        { type: "pc.showDesktop", params: {} },
        { type: "app.open", params: { path: "notepad.exe" } },
      ],
    },
  },
  {
    id: "start-work",
    name: "Start Work",
    description: "Open your everyday work apps and inbox to start the day.",
    category: "Productivity",
    flow: {
      name: "Start Work",
      actions: [
        { type: "app.open", params: { path: "notepad.exe" } },
        { type: "web.openWebsite", params: { url: "https://mail.google.com" } },
        { type: "pc.openExplorer", params: {} },
      ],
    },
  },
  {
    id: "meeting-mode",
    name: "Meeting Mode",
    description: "Mute your system audio, open your meeting notes, and jump into a call.",
    category: "Productivity",
    flow: {
      name: "Meeting Mode",
      actions: [
        { type: "pc.mute", params: {} },
        { type: "app.open", params: { path: "notepad.exe" } },
        { type: "web.openWebsite", params: { url: "https://meet.google.com" } },
      ],
    },
  },
  {
    id: "coding-mode",
    name: "Coding Mode",
    description: "Open your editor and a terminal side by side.",
    category: "Development",
    flow: {
      name: "Coding Mode",
      actions: [
        { type: "app.open", params: { path: "notepad.exe" } },
        { type: "pc.openTerminal", params: {} },
        { type: "app.maximize", params: { processName: "notepad.exe", displayName: "Notepad" } },
      ],
    },
  },
  {
    id: "open-development-tools",
    name: "Open Development Tools",
    description: "Open a terminal, Task Manager, and GitHub.",
    category: "Development",
    flow: {
      name: "Open Development Tools",
      actions: [
        { type: "pc.openTerminal", params: {} },
        { type: "pc.openTaskManager", params: {} },
        { type: "web.openWebsite", params: { url: "https://github.com" } },
      ],
    },
  },
  {
    id: "gaming-mode",
    name: "Gaming Mode",
    description: "Raise the volume, close a background app, and clear the desktop before you play.",
    category: "Gaming",
    flow: {
      name: "Gaming Mode",
      actions: [
        { type: "pc.volumeUp", params: {} },
        { type: "app.close", params: { processName: "notepad.exe" } },
        { type: "pc.showDesktop", params: {} },
      ],
    },
  },
  {
    id: "launch-game-setup",
    name: "Launch Game Setup",
    description: "Launch your game and maximize the window once it opens.",
    category: "Gaming",
    flow: {
      name: "Launch Game Setup",
      actions: [
        { type: "app.open", params: { path: "notepad.exe" } },
        { type: "event.wait", params: { milliseconds: 3000 } },
        { type: "app.maximize", params: { processName: "notepad.exe", displayName: "Notepad" } },
      ],
    },
  },
  {
    id: "open-daily-websites",
    name: "Open Daily Websites",
    description: "Open your everyday websites in one click.",
    category: "Browser / Web",
    flow: {
      name: "Open Daily Websites",
      actions: [
        { type: "web.openWebsite", params: { url: "https://mail.google.com" } },
        { type: "web.openWebsite", params: { url: "https://calendar.google.com" } },
        { type: "web.openWebsite", params: { url: "https://github.com" } },
      ],
    },
  },
  {
    id: "research-setup",
    name: "Research Setup",
    description: "Start a research session with search, references, and notes ready.",
    category: "Browser / Web",
    flow: {
      name: "Research Setup",
      actions: [
        { type: "web.searchGoogle", params: { query: "Swipey" } },
        { type: "web.openWebsite", params: { url: "https://scholar.google.com" } },
        { type: "app.open", params: { path: "notepad.exe" } },
      ],
    },
  },
  {
    id: "workstation-setup",
    name: "Workstation Setup",
    description: "Open Explorer, your primary app, and a terminal to set up your workstation.",
    category: "System",
    flow: {
      name: "Workstation Setup",
      actions: [
        { type: "pc.openExplorer", params: {} },
        { type: "app.open", params: { path: "notepad.exe" } },
        { type: "pc.openTerminal", params: {} },
        { type: "app.maximize", params: { processName: "notepad.exe", displayName: "Notepad" } },
      ],
    },
  },
];

export function templateActionLabels(template) {
  return (template.flow.actions || []).map((action) => findCommand(action.type)?.label || action.type);
}

export function findTemplate(templateId) {
  return flowTemplates.find((template) => template.id === templateId) || null;
}
