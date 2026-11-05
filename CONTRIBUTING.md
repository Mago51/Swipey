# Contributing

Swipey is a free, open-source project (GPL-3.0-only). Bug reports, fixes and improvements are welcome.

## Setup

You need Windows 10/11, Node.js with npm, and the .NET SDK (8 or newer).

```
npm install
npm run build:native
```

`npm run build:native` compiles the C# helpers in `native/`. Keys, Swipes and the window actions need them.

## Running

```
npm start
```

The start script clears `ELECTRON_RUN_AS_NODE` before launching Electron. Keep that, otherwise Electron runs as plain Node and its APIs are missing.

Set `SWIPEY_KEY_DEBUG=1` or `SWIPEY_SWIPE_DEBUG=1` to get extra console output for key and swipe handling.

## Tests

```
npm run check   # syntax check of all JavaScript files
npm test        # all test suites
```


## Guidelines

- Keep changes focused. One fix or feature per pull request.
- Flows are reusable action chains. Keys and Swipes only trigger them; do not mix the two.
- Add new actions to the catalog in `src/commands/` and to `src/main/actionRegistry.js`, and add a test.
- Keep styling in `Styles/` and use the tokens from `tokens.css` instead of hard-coded values.
- Run `npm run check` and `npm test` before opening a pull request.
- Swipey stays free: no paid tiers or feature locks.
