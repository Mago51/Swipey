# Flow Structure

Swipey now supports a structured Flow node model. The old linear `actions` list is still accepted for compatibility, but storage normalizes Flows to `nodes`.

## Schema

Action node:

```json
{
  "id": "node_...",
  "type": "action",
  "actionId": "app.open",
  "config": {}
}
```

Repeat:

```json
{
  "id": "node_...",
  "type": "repeat",
  "count": 3,
  "children": []
}
```

If / Else:

```json
{
  "id": "node_...",
  "type": "if",
  "condition": { "type": "app-running", "target": { "processName": "notepad.exe" } },
  "then": [],
  "else": []
}
```

Random Choice:

```json
{
  "id": "node_...",
  "type": "random-choice",
  "branches": [[], []]
}
```

Other container/control nodes:

- `wait-until` with `condition`, `timeoutMs`, `pollIntervalMs`
- `delay-between-actions` with `delayMs` and `children`
- `run-after-delay` with `delayMs` and `children`
- `try` with `children` and `onError` (see [flow-variables.md](flow-variables.md#try--on-error))
- `continue-on-error` with `children` (see [flow-variables.md](flow-variables.md#continue-on-error))

## Migration

Old Flows shaped as `actions: [...]` are converted to action nodes on load or save. The renderer and IPC response still include a top-level `actions` mirror for compatibility, but nested logic lives in `nodes`.

Existing action instance ids are preserved when migrated. Duplicating a Flow or a nested node deep-copies children with new node ids.

## Conditions

The condition registry supports three families. See [flow-variables.md](flow-variables.md#conditions) for the Variable and Execution Result families.

App conditions (`app.running` / `app.not-running` in the catalog, stored as `app-running` / `app-not-running`) use the shared app target shape already used by app window actions:

```json
{
  "processName": "notepad.exe",
  "executablePath": "",
  "windowTitle": "",
  "displayName": "Notepad"
}
```

Variable conditions (`variable.equals`, `variable.not-equals`, `variable.greater-than`, `variable.greater-or-equal`, `variable.less-than`, `variable.less-or-equal`, `variable.contains`, `variable.is-true`, `variable.is-false`, `variable.exists`) are stored as:

```json
{
  "type": "variable.greater-than",
  "variableName": "counter",
  "compareType": "number",
  "compareValue": 5
}
```

Execution Result conditions (`execution.last-action-succeeded`, `execution.last-action-failed`) are stored as just `{ "type": "execution.last-action-succeeded" }`.

## Executor Limits

- Max node nesting depth: 10
- Max Repeat count: 100
- Max Random Choice branches: 10
- Min Random Choice branches: 2
- Max executed nodes per Flow run: 5000
- Max Run Another Flow nesting depth: 10
- Wait Until timeout: 250ms through 10 minutes
- Wait Until poll interval: 50ms through 5000ms

When a limit is exceeded, execution stops with a structured error code such as `FLOW_NODE_LIMIT_EXCEEDED`, `FLOW_NODE_DEPTH_EXCEEDED`, or `INVALID_REPEAT_COUNT`.

## Recursion

Run Another Flow stores only a `flowId` reference. It does not copy actions. Recursion is blocked for:

- A -> A
- A -> B -> A
- A -> B -> C -> A

These return `FLOW_RECURSION_DETECTED`.

## Scheduling

`run-after-delay` is implemented as an in-execution delay group: the current Flow waits, then runs the child nodes. It is not detached background scheduling.

## Builder V1

Top-level drag/reorder remains supported. Structured containers render nested areas with click-to-add controls for child actions.
