// `node --import ./tests/support/register.mjs --test`
//
// The test runner gives each test file its own process and passes this down to
// all of them, so every file gets the host specifiers resolved and the globals
// in place without importing anything itself.
//
// The mod imports `herdr`, `gpui-kit` and `gpui-base` from nowhere: the app
// injects them. Node cannot resolve them, so a resolve hook points them at the
// doubles in `host/`. A hook rather than a `node_modules` shim or a bundler:
// the mod's own source is imported unmodified, exactly as the app loads it.
// Nothing here is in the installed mod, so the thing under test is the thing
// that ships.

import { registerHooks } from "node:module";

import "./globals.js";

const HOST = new Map([
  ["herdr", new URL("./host/herdr.js", import.meta.url).href],
  ["gpui-kit", new URL("./host/gpui-kit.js", import.meta.url).href],
  ["gpui-base", new URL("./host/gpui-base.js", import.meta.url).href],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = HOST.get(specifier);
    if (mapped) return { url: mapped, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
