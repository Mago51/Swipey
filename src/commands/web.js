export const webCommands = [
  {
    id: "web.openWebsite",
    label: "Open Website",
    type: "web",
    description: "Open a validated http or https URL.",
    defaultConfig: { url: "https://example.com" },
  },
  {
    id: "web.searchGoogle",
    label: "Search Web",
    type: "web",
    description: "Search the web with Google.",
    defaultConfig: { query: "Swipey" },
  },
  {
    id: "web.searchYouTube",
    label: "YouTube Search",
    type: "web",
    description: "Search YouTube for a query.",
    defaultConfig: { query: "Swipey" },
  },
  {
    id: "web.openClipboardUrl",
    label: "Open URL from Clipboard",
    type: "web",
    description: "Open the current clipboard text when it is a valid URL.",
    defaultConfig: {},
  },
  {
    id: "web.openInBrowser",
    label: "Open Website in Browser",
    type: "web",
    description: "Open a website in a chosen browser.",
    defaultConfig: { url: "https://example.com", browserId: "edge" },
  },
  {
    id: "web.openMultiple",
    label: "Open Multiple Websites",
    type: "web",
    description: "Open several websites in sequence.",
    defaultConfig: { urls: ["https://example.com"], browserId: "default", delayMs: 250 },
  },
];
