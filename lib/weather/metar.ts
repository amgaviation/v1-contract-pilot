import "server-only";

/**
 * The real import path for app code (route.ts, page.tsx). All the actual
 * logic — including the never-throw fetch wrapper — lives in
 * ./metar-core, which carries no `server-only` marker so it stays
 * importable from tests/weather-metar.test.mjs under plain `node --test`.
 * See that file's header for why.
 */
export * from "./metar-core";
