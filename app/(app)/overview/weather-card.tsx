"use client";

import * as React from "react";
import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LStat, lButtonClass } from "@/components/ledger";
import type { FlightCategory, MetarResult } from "@/lib/weather/metar";

const ICAO_PATTERN = /^[A-Z0-9]{3,4}$/;

const CATEGORY_TONE: Record<Exclude<FlightCategory, null>, "good" | "warn" | "crit"> = {
  VFR: "good",
  MVFR: "warn",
  IFR: "crit",
  LIFR: "crit",
};

function categoryTone(cat: FlightCategory): "good" | "warn" | "crit" | "neutral" {
  return cat ? CATEGORY_TONE[cat] : "neutral";
}

/** obsTime has no dedicated helper in lib/format.ts — every export there
 *  formats a calendar `date` column (parsed as UTC midnight), and a METAR
 *  observation is a real instant with a time-of-day that matters to a
 *  pilot deciding whether it's still current. Formatted directly with
 *  Intl here rather than stretching parseCalendarDate to a shape it was
 *  never meant for. */
function formatObservedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function windSummary(
  dir: number | null,
  speed: number | null,
  gust: number | null
): string {
  if (speed === null) return "—";
  if (speed === 0) return "Calm";
  const dirLabel = dir === null ? "Variable" : `${dir}°`;
  const gustLabel = gust !== null && gust > speed ? ` G${gust}` : "";
  return `${dirLabel} at ${speed}${gustLabel} kt`;
}

export function WeatherCard({
  homeBase,
  initial,
}: {
  homeBase: string | null;
  initial: MetarResult | null;
}) {
  // LOCAL STATE ONLY, NOT PERSISTED. A pilot who looks up a scratch
  // station (say, their destination rather than home base) has that
  // choice forgotten the moment they leave this page — it resets to
  // `homeBase` on next visit. That's a deliberate tradeoff, not an
  // oversight: pinning a manually-looked-up ICAO across sessions would
  // need a new nullable column and its own UI, and nothing about this
  // v1 request asked for that. Revisit only if pilots actually ask to
  // pin a scratch station.
  const [icao, setIcao] = React.useState(homeBase ?? "");
  const [result, setResult] = React.useState<MetarResult | null>(initial);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function lookup(rawIcao: string) {
    const normalized = rawIcao.trim().toUpperCase();
    setIcao(normalized);
    if (!ICAO_PATTERN.test(normalized)) {
      setFieldError("Enter a 3–4 character ICAO or FAA identifier.");
      return;
    }
    setFieldError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/weather/metar?icao=${encodeURIComponent(normalized)}`);
      const data = (await res.json()) as MetarResult;
      setResult(data);
    } catch {
      setResult({
        ok: false,
        kind: "refused",
        error: "Couldn't reach the weather service.",
      });
    } finally {
      setPending(false);
    }
  }

  const showNoHomeBase = !homeBase && !initial;

  return (
    <LCard className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3 font-semibold">Weather</h2>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(icao);
          }}
        >
          <input
            value={icao}
            onChange={(e) => setIcao(e.target.value.toUpperCase())}
            onBlur={(e) => setIcao(e.target.value.trim().toUpperCase())}
            placeholder="ICAO"
            maxLength={4}
            className="h-8 w-24 rounded-control border border-hair-strong bg-card px-2 text-body-s uppercase tracking-wide text-ink"
          />
          <button
            type="submit"
            disabled={pending}
            className={lButtonClass({ variant: "outline", size: "sm" })}
          >
            {pending ? "Looking up…" : "Look up"}
          </button>
        </form>
      </div>

      {fieldError ? (
        <p className="text-caption text-crit">{fieldError}</p>
      ) : null}

      {showNoHomeBase ? (
        <LEmpty title="No home base set" as="h3">
          Set a home base in{" "}
          <NextLink href="/settings" className="underline">
            settings
          </NextLink>{" "}
          to see its weather here automatically, or look up any station above.
        </LEmpty>
      ) : !result ? null : !result.ok ? (
        result.kind === "invalid_ident" ? (
          <p className="text-caption text-ink-3">{result.error}</p>
        ) : result.kind === "not_found" ? (
          <LAlert tone="neutral">
            {`No current observation for ${icao || homeBase || "this station"}. Station may not report METARs.`}
          </LAlert>
        ) : (
          <LAlert tone="warn">
            Couldn&rsquo;t reach the weather service. Try again.
          </LAlert>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-h3 font-semibold tnum-l">{result.observation.icao}</span>
            <LPill tone={categoryTone(result.observation.flightCategory)}>
              {result.observation.flightCategory ?? "Unknown"}
            </LPill>
            <span className="text-caption text-ink-3">
              {formatObservedAt(result.observation.observedAt)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <LStat
              label="Wind"
              figure={windSummary(
                result.observation.windDirDeg,
                result.observation.windSpeedKt,
                result.observation.windGustKt
              )}
            />
            <LStat
              label="Visibility"
              figure={
                result.observation.visibilitySm === null
                  ? "—"
                  : `${result.observation.visibilitySm} SM`
              }
            />
            <LStat
              label="Ceiling"
              figure={
                result.observation.ceilingFt !== null
                  ? `${result.observation.ceilingFt.toLocaleString()} ft`
                  : result.observation.cloudsReported
                    ? "Clear"
                    : "—"
              }
            />
            <LStat
              label="Temp / Dewpoint"
              figure={
                result.observation.tempC === null
                  ? "—"
                  : `${result.observation.tempC}° / ${result.observation.dewpointC ?? "—"}°C`
              }
            />
            <LStat
              label="Altimeter"
              figure={
                result.observation.altimeterInHg === null
                  ? "—"
                  : `${result.observation.altimeterInHg.toFixed(2)} inHg`
              }
            />
          </div>

          <p className="whitespace-pre-wrap break-words font-mono text-caption text-ink-3">
            {result.observation.rawText}
          </p>
        </div>
      )}

      <p className="text-caption text-ink-3">
        For situational awareness only — verify with an official weather briefing before flight.
      </p>
    </LCard>
  );
}
