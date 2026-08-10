// A Node.js module-customization hook (the documented `module.register`
// API — https://nodejs.org/api/module.html#customization-hooks — NOT a
// hand-rolled TS-stripping regex) that lets `node --experimental-strip-types`
// resolve this codebase's extensionless relative imports (e.g.
// `import { parseCsv } from "./csv"`) to their real `.ts` file. Node's own
// ESM resolver requires an explicit extension; this repo's source files
// deliberately don't have one (standard TS style), so verify scripts that
// run real `.ts` files directly need this one small resolution shim.
//
// Used ONLY by scripts/foreflight-import-verify.mjs (via `--import`) to run
// the real lib/logbook-import/*.ts parser code against a synthetic fixture
// — it does not touch, transpile, or reinterpret any TypeScript syntax
// itself; type-stripping is entirely Node's own `--experimental-strip-types`.
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Self-registers as Node's module customization hook when preloaded via
// `--import` (the documented pattern for a hooks file that is also its own
// entry point — https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options).
register(import.meta.url, { parentURL: import.meta.url });

const EXTENSIONS = [".ts", ".tsx", ".mts"];
// This repo's own tsconfig.json path alias (`"@/*": ["./*"]`) — mirrored
// here, not invented, because a verify script running real `.ts` files
// outside the Next.js/webpack build has no other resolver honoring it.
const REPO_ROOT = new URL("../../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  let parentURL = context.parentURL;
  if (specifier.startsWith("@/")) {
    target = "./" + specifier.slice(2);
    parentURL = REPO_ROOT.href;
  }
  try {
    return await nextResolve(target, { ...context, parentURL });
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    if (!target.startsWith(".") && !target.startsWith("/")) throw err;
    const base = parentURL ? new URL(target, parentURL) : new URL(target, "file://");
    const basePath = fileURLToPath(base);
    for (const ext of EXTENSIONS) {
      if (existsSync(basePath + ext)) {
        return nextResolve(pathToFileURL(basePath + ext).href, context);
      }
    }
    throw err;
  }
}
