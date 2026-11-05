# Flow Variables and Error Handling

This document covers the variable model, template interpolation, condition operators, and structured error handling introduced alongside conditional automation (Repeat, If / Else, Run Another Flow, Wait Until, Random Choice).

## Variable model

Variables live only in `src/main/variables.js` (`ExecutionVariables`, backed by a `Map`, never a plain object) and are scoped to a single Flow execution (`context.execution.variables`). They are **not** global application state and are **not** persisted - only the Flow nodes that produce them (Set Variable, Increment/Decrement Variable) are saved. A restarted app, or a fresh manual run, always starts with an empty variable store.

Supported runtime value types: `string`, `number`, `boolean`, and (internally) `null`. Set Variable itself only exposes `string` / `number` / `boolean` in its config, matching the Flow Builder's type selector. Arrays, objects, functions, and arbitrary JS values are never supported.

### Naming rules

- 1-32 characters, must start with a letter, followed by letters/digits/underscores (`^[A-Za-z][A-Za-z0-9_]{0,31}$`).
- `__proto__`, `prototype`, and `constructor` are rejected outright, in addition to never being reachable through the `Map`-backed store.
- Invalid or reserved names fail with `INVALID_VARIABLE_NAME` / `RESERVED_VARIABLE_NAME` at both Set Variable validation time and in variable conditions.

### Values

- `string` values are capped at 10,000 characters (`VARIABLE_STRING_TOO_LONG`).
- `number` values must be finite (`NaN`/`Infinity`/`-Infinity` are rejected as `INVALID_VARIABLE_VALUE`).
- `boolean` values must be a real boolean (accepts the strings `"true"`/`"false"` from UI controls, coerced explicitly - never truthy/falsy coercion).

## Scope and Run Another Flow

Variables are scoped to the execution that created them. `Run Another Flow` shares the **same** variable store with the child Flow (so a child can read and write values the parent set), but everything else about the nested run - its own action log, its own `lastResult`/`lastError`, its own node-count limit - stays independent. A separate, unrelated Flow run (or the same Flow run again) never sees variables from a prior run: each top-level `runFlow()` call starts a brand-new, empty store unless one is explicitly threaded through (which only `Run Another Flow` does).

```
Flow A:
  Set Variable project = "Swipey"
  Run Flow B

Flow B:
  Type Text "{{project}}"     // resolves to "Swipey"
```

Concurrent or independent runs of Flow B on its own (without Flow A) fail with `VARIABLE_NOT_FOUND` for `{{project}}`, because nothing set it in that execution.

## Set / Increment / Decrement Variable

- `event.setVariable` - `{ name, valueType, value }`. Validates the name and the value against `valueType`, then stores it.
- `event.incrementVariable` / `event.decrementVariable` - `{ name, amount }` (`amount` defaults to `1`). Both share one numeric-mutation code path (`mutateNumericVariable` in `actionRegistry.js`). Errors:
  - `VARIABLE_NOT_FOUND` - the variable was never set in this execution.
  - `VARIABLE_NOT_NUMBER` - the variable exists but holds a string or boolean.
  - `INVALID_INCREMENT` - the amount (or the resulting value) is not a finite number.

## Template interpolation

One centralized resolver, `resolveTemplate(template, variables)` in `src/main/variables.js`, is used everywhere `{{name}}` substitution happens - no action implements its own string replacement.

- Only exact `{{identifier}}` tokens are recognized (`{{name}}`, with optional inner whitespace). No expressions, no math, no function calls, no property access (`{{foo.bar}}` never matches - the dot isn't part of the pattern - so it passes through untouched as literal text), and no nested re-evaluation of a resolved value.
- A referenced variable that doesn't exist in the current execution makes the action fail with `VARIABLE_NOT_FOUND` (never silently becomes an empty string). The missing variable's name is included in the structured error detail for developer logs.
- Actions opt in per-field via a `templatableFields: [...]` list on their `actionRegistry.js` definition. Today that's `pc.typeText` (`text`), `web.openWebsite` (`url`), `web.searchGoogle` / `web.searchYouTube` (`query`), and `event.stopWithError` (`message`).
- Resolution happens centrally in `flowExecutor.js`'s `runAction()`, **before** the action's own `validate()` runs - so a resolved URL is validated as a real URL only after substitution, never before. Static Flow-save-time validation (which doesn't know variable values yet) is intentionally lenient for a field that still contains `{{...}}` syntax; the strict, authoritative check happens at execution time on the resolved string.
- The Flow Builder's "+ Variable" control on templatable fields inserts `{{name}}` at the cursor. It only lists variable names it can find from a **Set Variable** node earlier in the same node list, walking into `children`/`then`/`else`/`onError`/branches in document order up to the current node - a simple linear heuristic, not full data-flow analysis (branches can differ, so this never claims a variable is *guaranteed* to exist at runtime).

## Conditions

The condition registry (`src/main/conditionRegistry.js`) has three families, all usable from **If / Else** and **Wait Until**:

### App

`app.running` / `app.not-running` (unchanged from the previous batch).

### Variable

`variable.equals`, `variable.not-equals`, `variable.greater-than`, `variable.greater-or-equal`, `variable.less-than`, `variable.less-or-equal`, `variable.contains`, `variable.is-true`, `variable.is-false`, `variable.exists`.

Comparisons are explicitly typed - never JavaScript loose equality (`==`) or implicit coercion:

- `greater-than`/`greater-or-equal`/`less-than`/`less-or-equal` require the variable **and** the comparison value to both be `number`.
- `contains` requires both to be `string` (substring match via `String.prototype.includes`).
- `equals`/`not-equals` require the variable's actual type to match the declared comparison type (`compareType`); a `number` variable is never compared against a `string` literal.
- `is-true`/`is-false` require the variable to be a `boolean`.
- `exists` is the only operator that doesn't throw when the variable is missing - it's how you test for presence.

A type mismatch throws `VARIABLE_TYPE_MISMATCH`; a missing variable (for any operator other than `exists`) throws `VARIABLE_NOT_FOUND`.

### Execution Result

`execution.last-action-succeeded` / `execution.last-action-failed`, backed by `context.execution.lastResult` (set after every action node runs, success or failure - see "Execution context" below).

## Try / On Error

```json
{
  "id": "node_...",
  "type": "try",
  "children": [],
  "onError": []
}
```

- `children` run sequentially. If they all succeed, `onError` is skipped entirely.
- If any child fails, the structured error is captured into `context.execution.lastError`, and `onError` runs. If `onError` completes (even if it contains actions that themselves fail and are caught by a nested Try), the failure is considered handled and the Flow continues normally after the Try node - it does **not** automatically stop the whole Flow.
- If `onError` itself fails, that failure propagates upward exactly like any other action failure (to an enclosing Try, or to the Flow as a whole).
- Try nodes nest freely, including Try inside Repeat (each iteration gets its own try/catch) and Repeat inside Try.

There is no `finally` branch in this batch.

## Continue On Error

```json
{
  "id": "node_...",
  "type": "continue-on-error",
  "children": []
}
```

Runs its children in order. If one fails, the failure is recorded (`context.execution.lastError`) and the container moves on to the next child instead of stopping. The container itself always "succeeds" (from the point of view of the rest of the Flow) once it finishes its children - it is not a silent global failure toggle; it only changes behavior for the actions placed directly inside it. A failing action **outside** a Continue On Error container still stops the Flow immediately, exactly as before this batch.

## Stop Flow with Error

`event.stopWithError` - `{ message }` (`message` supports `{{variable}}` templates, resolved before the Flow fails). Execution throws a structured error with code `FLOW_STOPPED_WITH_ERROR` and the resolved message. This is deliberately distinct from the existing `event.stopFlow`:

- `event.stopFlow` - intentional, successful stop (`result.success === true`, `result.reason === "STOP_FLOW"`).
- `event.stopWithError` - failed Flow execution (`result.success === false`, `result.error.code === "FLOW_STOPPED_WITH_ERROR"`).

Like any other action failure, an uncaught `Stop Flow with Error` fails the Flow; a Try node around it catches it like any other failure.

## Execution context

Formalized in `flowExecutor.js`. Each `runFlow()` call gets:

```
{
  executionId,
  signal,
  executedNodeCount,
  actions: [],
  variables: ExecutionVariables,
  lastResult: { ok, code, actionId, nodeId } | null,
  lastError: { code, message, actionId, nodeId } | null,
}
```

`lastResult`/`lastError` update after every action node runs (success or failure) and after every Try/Continue On Error catch. They are read-only from a Flow author's perspective - there is no action that lets a Flow overwrite them directly, only the two Execution Result conditions read them.

`Run Another Flow` passes only `variables` down to the child's execution (see "Scope" above) - it does not share `actions`, `lastResult`, `executedNodeCount`, or any other execution metadata, so a failure inside the child Flow reports against the child's own node ids, and the child's node-count limit is independent of the parent's.

## Error propagation summary

- A plain action failure stops the current sequential node list, which stops its enclosing container, which stops the Flow - unless a Try or Continue On Error along the way catches it.
- Repeat: a child failure stops the Repeat (and propagates) unless caught by a Try/Continue On Error inside or around it.
- If / Else: the selected branch's failure propagates like any other node list.
- Random Choice: the selected branch's failure propagates.
- Run Another Flow: the child Flow's failure propagates to the parent action node as `FLOW_STOPPED_WITH_ERROR`/whatever code the child failed with, unless caught by a Try around the `Run Another Flow` action in the parent.
