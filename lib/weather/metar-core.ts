/**
 * METAR CLIENT CORE — the only place this product talks to NOAA's
 * `aviationweather.gov` public data API. No key, no config, no client
 * object: a plain fetch wrapper, same shape as lib/email/send.ts's
 * never-throw contract for a raw external HTTP call.
 *
 * NOT MARKED `server-only` ITSELF, deliberately, so tests/weather-metar
 * .test.mjs can import fetchMetar directly and mock `global.fetch` — the
 * same split lib/email/send.ts uses (its mockable guard lives in
 * address.ts, un-marked, while send.ts itself carries the server-only
 * marker and re-exports it). lib/weather/metar.ts is the real import
 * path for app code: it carries the `server-only` marker and re-exports
 * everything from here. `server-only`'s package.json only swaps in a
 * no-op under the `react-server` bundler condition, so importing a
 * server-only-marked module under a plain `node --test` run throws
 * unconditionally — the reason this logic lives in the unmarked file.
 *
 * WHY THIS NEVER THROWS. This feeds a dashboard card, not a payment path,
 * but the same rule from lib/email/send.ts applies for the same reason: a
 * thrown error inside a server component's Promise.all becomes an unhandled
 * rejection, which for a page render is a dead screen rather than a
 * degraded card. Every branch below resolves to a typed MetarResult.
 *
 * Verified live shape (see the plan this file implements):
 *   curl https://aviationweather.gov/api/data/metar?ids=KJFK&format=json
 *   -> [{"icaoId":"KJFK","obsTime":1787338260,"rawOb":"METAR KJFK 211851Z ...",
 *        "temp":24.4,"dewp":17.2,"wdir":60,"wspd":9,"visib":"10+","altim":1018,
 *        "clouds":[{"cover":"BKN","base":3400}],"fltCat":"VFR"}]
 * An empty array is a legitimate "no current observation", not an error.
 */

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR" | null;

export type MetarObservation = {
  icao: string;
  /** ISO instant, converted from the API's obsTime (epoch seconds). */
  observedAt: string;
  rawText: string;
  flightCategory: FlightCategory;
  /** null = variable/calm, matching the API's own omission for those cases. */
  windDirDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  /** "10+" from the API collapses to 10. */
  visibilitySm: number | null;
  /** Lowest BKN/OVC base among `clouds`; null when there is none (or CLR).
   *  Only meaningful when `cloudsReported` is true — see below. */
  ceilingFt: number | null;
  clouds: { cover: string; baseFt: number | null }[];
  /** False when the API omitted the `clouds` field entirely, as opposed to
   *  reporting it as an empty array (a genuine "sky clear" observation).
   *  `ceilingFt === null` is ambiguous between these two cases on its own,
   *  so the UI must check this before rendering "Clear". */
  cloudsReported: boolean;
  tempC: number | null;
  dewpointC: number | null;
  /** altim (hPa) / 33.8639, rounded to 2 decimal places. */
  altimeterInHg: number | null;
};

export type MetarResult =
  | { ok: true; observation: MetarObservation }
  | {
      ok: false;
      kind: "invalid_ident" | "not_found" | "timeout" | "refused";
      error: string;
    };

/** Same ICAO/FAA-ident shape as `trip_legs.from_icao`'s check constraint. */
const ICAO_PATTERN = /^[A-Z0-9]{3,4}$/;

const TIMEOUT_MS = 8_000;
/** METARs are issued hourly with occasional SPECIs — 10 minutes is fresh
 *  enough for a dashboard glance without hammering a keyless public
 *  endpoint on every render. */
const REVALIDATE_SECONDS = 600;
const HPA_PER_INHG = 33.8639;

type RawCloud = { cover?: string; base?: number | null };

type RawObservation = {
  icaoId?: string;
  obsTime?: number;
  rawOb?: string;
  fltCat?: string;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: number | string | null;
  clouds?: RawCloud[] | null;
  temp?: number | null;
  dewp?: number | null;
  altim?: number | null;
};

function toFlightCategory(value: string | undefined): FlightCategory {
  if (value === "VFR" || value === "MVFR" || value === "IFR" || value === "LIFR") {
    return value;
  }
  return null;
}

/** wdir is occasionally the string "VRB" (variable) rather than a number —
 *  that reads as "no fixed direction", the same as an absent value. */
function toWindDir(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function toVisibility(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed.endsWith("+")) {
    const n = Number(trimmed.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toClouds(raw: RawCloud[] | null | undefined): { cover: string; baseFt: number | null }[] {
  if (!raw) return [];
  return raw.map((c) => ({
    cover: c.cover ?? "",
    baseFt: typeof c.base === "number" && Number.isFinite(c.base) ? c.base : null,
  }));
}

/** Lowest base among BKN/OVC layers — the ceiling as pilots use the word. */
function toCeiling(clouds: { cover: string; baseFt: number | null }[]): number | null {
  const bases = clouds
    .filter((c) => c.cover === "BKN" || c.cover === "OVC")
    .map((c) => c.baseFt)
    .filter((b): b is number => b !== null);
  if (bases.length === 0) return null;
  return Math.min(...bases);
}

function toAltimeter(hpa: number | null | undefined): number | null {
  if (typeof hpa !== "number" || !Number.isFinite(hpa)) return null;
  return Math.round((hpa / HPA_PER_INHG) * 100) / 100;
}

function mapObservation(raw: RawObservation): MetarObservation {
  const clouds = toClouds(raw.clouds);
  return {
    icao: raw.icaoId ?? "",
    observedAt:
      typeof raw.obsTime === "number"
        ? new Date(raw.obsTime * 1000).toISOString()
        : new Date(0).toISOString(),
    rawText: raw.rawOb ?? "",
    flightCategory: toFlightCategory(raw.fltCat),
    windDirDeg: toWindDir(raw.wdir),
    windSpeedKt: typeof raw.wspd === "number" && Number.isFinite(raw.wspd) ? raw.wspd : null,
    windGustKt: typeof raw.wgst === "number" && Number.isFinite(raw.wgst) ? raw.wgst : null,
    visibilitySm: toVisibility(raw.visib),
    ceilingFt: toCeiling(clouds),
    clouds,
    cloudsReported: raw.clouds != null,
    tempC: typeof raw.temp === "number" && Number.isFinite(raw.temp) ? raw.temp : null,
    dewpointC: typeof raw.dewp === "number" && Number.isFinite(raw.dewp) ? raw.dewp : null,
    altimeterInHg: toAltimeter(raw.altim),
  };
}

export async function fetchMetar(icao: string): Promise<MetarResult> {
  const normalized = icao.trim().toUpperCase();
  if (!ICAO_PATTERN.test(normalized)) {
    return {
      ok: false,
      kind: "invalid_ident",
      error: `"${icao}" doesn't look like a valid ICAO/FAA identifier.`,
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${normalized}&format=json`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        next: { revalidate: REVALIDATE_SECONDS },
      }
    );
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      return {
        ok: false,
        kind: "timeout",
        error: "The weather service didn't respond in time.",
      };
    }
    return {
      ok: false,
      kind: "refused",
      error: "Couldn't reach the weather service.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: "refused",
      error: `The weather service refused the request (${response.status}).`,
    };
  }

  // The live API reports "no current observation" as HTTP 204 with an empty
  // body, not as 200 with `[]` — a 204/empty body is `not_found`, never a
  // parse failure. The body read itself can also fail mid-stream (dropped
  // connection, timeout expiring during the read) — that must land as
  // `refused`/`timeout`, not escape as an unhandled rejection, so it stays
  // inside the same guarded region as the fetch above.
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      return {
        ok: false,
        kind: "timeout",
        error: "The weather service didn't respond in time.",
      };
    }
    return {
      ok: false,
      kind: "refused",
      error: "Couldn't reach the weather service.",
    };
  }

  if (response.status === 204 || bodyText.trim() === "") {
    return {
      ok: false,
      kind: "not_found",
      error: `No current observation for ${normalized}.`,
    };
  }

  let payload: RawObservation[];
  try {
    payload = JSON.parse(bodyText) as RawObservation[];
  } catch {
    return {
      ok: false,
      kind: "refused",
      error: "The weather service returned something unreadable.",
    };
  }

  const first = Array.isArray(payload) ? payload[0] : undefined;
  if (!first) {
    return {
      ok: false,
      kind: "not_found",
      error: `No current observation for ${normalized}.`,
    };
  }

  return { ok: true, observation: mapObservation(first) };
}
