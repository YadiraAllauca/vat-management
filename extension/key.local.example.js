// Copy this file to `key.local.js` and put your key there:
//
//     cp extension/key.local.example.js extension/key.local.js
//
// THIS file is the template and IS committed: do not write your key here.
// `key.local.js` is gitignored and read only by the service worker.
globalThis.LILA_KEY = "sk-ant-...";

// Sonnet 5.5 costs half of Opus and is plenty for reading invoices.
// Alternatives: "claude-opus-5-5" (most exact, twice the price) or
// "claude-haiku-5-5" (cheapest).
globalThis.LILA_MODEL = "claude-sonnet-5-5";
