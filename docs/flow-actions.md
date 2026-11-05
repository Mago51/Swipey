# Flow Actions

The product action catalog lives in `src/commands/*.js`. It is the source of truth for user-facing Flow action metadata: stable `id`, category/type, display `label`, `description`, and `defaultConfig`.

Execution stays explicit in `src/main/actionRegistry.js`. Catalog metadata is never evaluated as code.

## Apps

- `app.open` - Open App - `{ path }`
- `app.close` - Close App - `{ processName }`
- `app.focus` - Focus App - `{ processName, executablePath, windowTitle, displayName }`
- `app.minimize` - Minimize App - `{ processName, executablePath, windowTitle, displayName }`
- `app.maximize` - Maximize App - `{ processName, executablePath, windowTitle, displayName }`
- `app.moveToPosition` - Move App to Position - `{ processName, executablePath, windowTitle, displayName, position }`
- `app.waitUntilOpens` - Wait Until App Opens - `{ processName, executablePath, displayName, timeoutMs, pollIntervalMs }`
- `app.ifRunning` - If App Is Running - creates an If / Else logic node using the shared app target condition
- `app.ifNotRunning` - If App Is Not Running - creates an If / Else logic node using the shared app target condition

The window actions use the user-space Windows automation helper in `native/windows-automation`. It targets visible top-level windows by process name, executable path, and optional title text, then uses documented Win32 user APIs for focus, minimize, maximize, monitor work-area placement, and existence checks. No admin rights, drivers, shell scripts, or PowerShell user text are used for these app-window actions.

## Web

- `web.openWebsite` - Open Website - `{ url }` (`url` supports `{{variable}}` templates)
- `web.searchGoogle` - Search Web - `{ query }`, currently Google-backed (`query` supports `{{variable}}` templates)
- `web.searchYouTube` - YouTube Search - `{ query }` (`query` supports `{{variable}}` templates)
- `web.openClipboardUrl` - Open URL from Clipboard
- `web.openInBrowser` - Open Website in Browser - `{ url, browserId }`
- `web.openMultiple` - Open Multiple Websites - `{ urls, browserId, delayMs }`

`web.openInBrowser` supports Edge, Chrome, Firefox, Brave, and Opera when installed. `web.openMultiple` validates every URL before opening anything, supports up to 20 URLs, opens sequentially, and uses either the selected browser or the Windows default URL handler.

## Events

- `event.wait` - Wait - `{ milliseconds }`
- `event.stopFlow` - Stop Flow
- `event.runFlow` - Run Another Flow - `{ flowId }`, with recursion and nesting protection
- `event.loop` - Repeat - structured container node with `count` and `children`
- `event.condition` - If / Else - structured branch node with App, Variable, or Execution Result conditions
- `event.randomChoice` - Random Choice - structured multi-branch node
- `event.delayBetweenActions` - Delay Between Actions - scoped delay container
- `event.runAfterDelay` - Run After Delay - in-execution delay group
- `event.waitUntil` - Wait Until - App, Variable, or Execution Result condition wait with timeout/polling
- `event.setVariable` - Set Variable - `{ name, valueType, value }`
- `event.incrementVariable` - Increment Variable - `{ name, amount }` (default `amount` 1)
- `event.decrementVariable` - Decrement Variable - `{ name, amount }` (default `amount` 1)
- `event.try` - Try / On Error - structured container node with `children` and `onError`
- `event.continueOnError` - Continue On Error - structured container node with `children`; each child's failure is recorded and skipped rather than stopping the container
- `event.stopWithError` - Stop Flow with Error - `{ message }`; fails the Flow with code `FLOW_STOPPED_WITH_ERROR` instead of the clean `event.stopFlow` stop. `message` supports `{{variable}}` templates.

See [flow-variables.md](flow-variables.md) for the variable model, template interpolation, condition operators, and error-handling semantics.

## PC

- `pc.lock` - Lock PC
- `pc.volumeUp` - Volume Up
- `pc.volumeDown` - Volume Down
- `pc.mute` - Mute / Unmute
- `pc.mediaPlayPause` - Play / Pause
- `pc.mediaNext` - Next Track
- `pc.mediaPrevious` - Previous Track
- `pc.screenshot` - Screenshot
- `pc.openExplorer` - Open Explorer
- `pc.openTaskManager` - Open Task Manager
- `pc.openSettings` - Open Settings
- `pc.copy` - Copy
- `pc.paste` - Paste
- `pc.undo` - Undo
- `pc.redo` - Redo
- `pc.selectAll` - Select All
- `pc.typeText` - Type Text - `{ text }` (`text` supports `{{variable}}` templates)
- `pc.pressKey` - Press Key - `{ key }`
- `pc.pressKeyCombination` - Press Key Combination - `{ combination }`
- `pc.showDesktop` - Show Desktop
- `pc.openTerminal` - Open Terminal
- `pc.setVolume` - Set Volume - `{ percent }`
- `pc.pastePresetText` - Paste Preset Text - `{ presetId }`
- `pc.keyboardSequence` - Keyboard Sequence - `{ steps }`

`pc.setVolume` uses the Windows Core Audio endpoint-volume API through the native helper instead of simulated volume key presses. `pc.pastePresetText` resolves the saved preset at execution time from the userData preset store, writes its text to the clipboard, and sends Ctrl+V. It does not restore the previous clipboard contents. `pc.keyboardSequence` supports up to 50 key, combo, or text steps, with `delayAfterMs` from 0 through 10000.

Script, shell, PowerShell, arbitrary command, variables, detached scheduling, and parallel/error branches require separate advanced safety designs before implementation.

## Migration

Legacy hyphenated action type ids are resolved to stable dotted ids in both the renderer catalog and main-process Flow storage normalization. Existing action instance ids are preserved.
