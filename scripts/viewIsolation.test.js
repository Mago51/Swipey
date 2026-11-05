const assert = require("assert");
const fs = require("fs");
const path = require("path");

const layoutCss = fs.readFileSync(path.join(__dirname, "..", "Styles", "layout.css"), "utf8");
const tokensCss = fs.readFileSync(path.join(__dirname, "..", "Styles", "tokens.css"), "utf8");
const sidebarCss = fs.readFileSync(path.join(__dirname, "..", "Styles", "sidebar.css"), "utf8");
const flowsCss = fs.readFileSync(path.join(__dirname, "..", "Styles", "flows.css"), "utf8");
const componentsCss = fs.readFileSync(path.join(__dirname, "..", "Styles", "components.css"), "utf8");
const flowEditorCss = fs.readFileSync(path.join(__dirname, "..", "Styles", "flow-editor.css"), "utf8");

assert.match(layoutCss, /\.view\s*\{[^}]*display:\s*none\s*;/s, "base .view rule must remove inactive views from layout");
assert.match(layoutCss, /\.view\.active\s*\{[^}]*display:\s*block\s*;/s, "active views must opt back into layout");
assert.match(layoutCss, /\.view\.view-centered\.active\s*\{[^}]*display:\s*grid\s*;/s, "centered view grid layout must apply only when active");

const bareCenteredDisplay = /(^|})\s*\.view-centered\s*\{[^}]*display\s*:/s.test(layoutCss);
assert.strictEqual(bareCenteredDisplay, false, "bare .view-centered must not override inactive .view display:none");

assert.match(tokensCss, /--color-app-bg:\s*#f8f8fc\s*;/, "app/root background token must use a premium light base");
assert.match(tokensCss, /--color-main-bg:\s*#f6f6fb\s*;/, "main content background token must stay light and distinct");
assert.match(tokensCss, /--color-accent-pink:\s*#ff4bb6\s*;/, "pink accent token must be centralized");
assert.match(tokensCss, /--background-app-atmosphere:\s*[^;]*radial-gradient/s, "app atmosphere must be tokenized");
assert.match(tokensCss, /--background-main-atmosphere:\s*[^;]*radial-gradient/s, "main atmosphere must be tokenized");
assert.match(tokensCss, /--background-canvas-atmosphere:\s*[^;]*radial-gradient/s, "builder canvas atmosphere must be tokenized");
assert.match(tokensCss, /--background-panel:\s*[^;]*linear-gradient/s, "premium panel background must be tokenized");
assert.match(tokensCss, /--background-control:\s*[^;]*linear-gradient/s, "premium control background must be tokenized");
assert.match(tokensCss, /--color-surface-elevated:\s*rgba\(255,\s*255,\s*255,\s*0\.94\)\s*;/, "card surface token must remain white and elevated");
assert.match(tokensCss, /--color-surface-primary:\s*#f4f2fa\s*;/, "control surface token must be subtly violet-neutral");
assert.match(tokensCss, /--color-border:\s*#ddd8e9\s*;/, "border token must use the refined violet-neutral border");

assert.match(layoutCss, /\.app-shell\s*\{[^}]*background:\s*var\(--background-app-atmosphere\)\s*;/s, "app shell must render the ambient app background");
assert.match(layoutCss, /\.workspace\s*\{[^}]*background:\s*var\(--background-main-atmosphere\)\s*;/s, "workspace must render the ambient main background");
assert.match(sidebarCss, /\.sidebar\s*\{[^}]*background:\s*var\(--background-sidebar\)\s*;/s, "sidebar must render its own translucent/tinted surface");
assert.match(flowsCss, /\.flow-overview-row\s*\{[^}]*background:\s*var\(--background-panel\)\s*;/s, "flow cards must render as premium panels");
assert.match(componentsCss, /\.trigger-row,\s*\.setting-row\s*\{[^}]*background:\s*var\(--background-panel\)\s*;/s, "binding rows and setting rows must render as premium panels");
assert.match(componentsCss, /\.flow-select\s*\{[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--color-surface-primary\),\s*white 34%\)\s*;/s, "flow selects must render as refined tinted controls inside cards");
assert.match(componentsCss, /\.master-toggle\s*\{[^}]*background:\s*var\(--background-control\)\s*;/s, "master toggle container must render as a premium control");
assert.match(componentsCss, /\.button\.primary\s*\{[^}]*background:\s*linear-gradient/s, "primary buttons must use the restrained violet gradient");
assert.match(flowEditorCss, /\.command-library\s*\{[^}]*background:\s*linear-gradient/s, "command library must be distinct from the builder canvas");
assert.match(flowEditorCss, /\.command-library\s*\{[^}]*overflow:\s*auto\s*;/s, "command library must scroll independently");
assert.match(flowEditorCss, /\.editor-shell\s*\{[^}]*height:\s*100%\s*;/s, "flow editor shell must constrain its internal panels");
assert.match(flowEditorCss, /\.flow-canvas\s*\{[^}]*background:\s*var\(--background-canvas-atmosphere\)\s*;/s, "builder canvas must use the ambient canvas background");

console.log("viewIsolation and surface hierarchy tests passed");
