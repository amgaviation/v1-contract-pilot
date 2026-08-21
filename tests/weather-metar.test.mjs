import test from "node:test";
import assert from "node:assert/strict";

const { fetchMetar } = await import("../lib/weather/metar-core.ts");

/**
 * The METAR client's field mapping and never-throw contract. All fixtures
 * synthetic (the verified KJFK sample from the plan this file implements),
 * no live network calls — global.fetch is mocked per test and restored
 * afterward.
 */

const SAMPLE = {
  icaoId: "KJFK",
  obsTime: 1787338260,
  rawOb:
    "METAR KJFK 211851Z COR 06009KT 10SM BKN034 BKN065 24/17 A3006 RMK AO2 SLP178 T02440172 $",
  temp: 24.4,
  dewp: 17.2,
  wdir: 60,
  wspd: 9,
  visib: "10+",
  altim: 1018,
  clouds: [
    { cover: "BKN", base: 3400 },
    { cover: "BKN", base: 6500 },
  ],
  fltCat: "VFR",
};

function mockFetch(impl) {
  const original = global.fetch;
  global.fetch = impl;
  return () => {
    global.fetch = original;
  };
}

test("maps the verified sample payload", async () => {
  const restore = mockFetch(async () =>
    new Response(JSON.stringify([SAMPLE]), { status: 200 })
  );
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const obs = result.observation;
    assert.equal(obs.icao, "KJFK");
    assert.equal(obs.observedAt, new Date(1787338260 * 1000).toISOString());
    assert.equal(obs.rawText, SAMPLE.rawOb);
    assert.equal(obs.flightCategory, "VFR");
    assert.equal(obs.windDirDeg, 60);
    assert.equal(obs.windSpeedKt, 9);
    assert.equal(obs.windGustKt, null);
    assert.equal(obs.visibilitySm, 10);
    assert.equal(obs.tempC, 24.4);
    assert.equal(obs.dewpointC, 17.2);
  } finally {
    restore();
  }
});

test("altimeter hPa -> inHg conversion, rounded to 2dp", async () => {
  const restore = mockFetch(async () =>
    new Response(JSON.stringify([SAMPLE]), { status: 200 })
  );
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 1018 / 33.8639 = 30.0616... -> 30.06
    assert.equal(result.observation.altimeterInHg, 30.06);
  } finally {
    restore();
  }
});

test("ceiling is the lowest BKN/OVC base among clouds[]", async () => {
  const restore = mockFetch(async () =>
    new Response(
      JSON.stringify([
        {
          ...SAMPLE,
          clouds: [
            { cover: "FEW", base: 1200 },
            { cover: "BKN", base: 3400 },
            { cover: "OVC", base: 2500 },
          ],
        },
      ]),
      { status: 200 }
    )
  );
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // FEW is not a ceiling layer; lowest of BKN 3400 / OVC 2500 is 2500.
    assert.equal(result.observation.ceilingFt, 2500);
  } finally {
    restore();
  }
});

test("no BKN/OVC layers -> null ceiling", async () => {
  const restore = mockFetch(async () =>
    new Response(
      JSON.stringify([{ ...SAMPLE, clouds: [{ cover: "FEW", base: 1200 }] }]),
      { status: 200 }
    )
  );
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.observation.ceilingFt, null);
  } finally {
    restore();
  }
});

test("empty array response -> not_found", async () => {
  const restore = mockFetch(async () => new Response(JSON.stringify([]), { status: 200 }));
  try {
    const result = await fetchMetar("KABC");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "not_found");
  } finally {
    restore();
  }
});

test("HTTP 204 with empty body (the live API's actual 'no observation' shape) -> not_found", async () => {
  const restore = mockFetch(async () => new Response(null, { status: 204 }));
  try {
    const result = await fetchMetar("KABC");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "not_found");
  } finally {
    restore();
  }
});

test("200 with an empty body -> not_found, not a parse failure", async () => {
  const restore = mockFetch(async () => new Response("", { status: 200 }));
  try {
    const result = await fetchMetar("KABC");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "not_found");
  } finally {
    restore();
  }
});

test("cloudsReported is true when the API sends a clouds array, even an empty one", async () => {
  const restore = mockFetch(async () =>
    new Response(JSON.stringify([{ ...SAMPLE, clouds: [] }]), { status: 200 })
  );
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.observation.cloudsReported, true);
    assert.equal(result.observation.ceilingFt, null);
  } finally {
    restore();
  }
});

test("cloudsReported is false when the API omits the clouds field entirely", async () => {
  const { clouds, ...withoutClouds } = SAMPLE;
  const restore = mockFetch(async () =>
    new Response(JSON.stringify([withoutClouds]), { status: 200 })
  );
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.observation.cloudsReported, false);
    assert.equal(result.observation.ceilingFt, null);
  } finally {
    restore();
  }
});

test("body read fails mid-stream -> refused, never an unhandled rejection", async () => {
  const restore = mockFetch(async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    return new Response(stream, { status: 200 });
  });
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "refused");
  } finally {
    restore();
  }
});

test("non-2xx response -> refused", async () => {
  const restore = mockFetch(async () => new Response("nope", { status: 500 }));
  try {
    const result = await fetchMetar("KJFK");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "refused");
  } finally {
    restore();
  }
});

test("regex rejection -> invalid_ident, with no fetch call", async () => {
  let called = false;
  const restore = mockFetch(async () => {
    called = true;
    return new Response(JSON.stringify([SAMPLE]), { status: 200 });
  });
  try {
    const result = await fetchMetar("!!bad!!");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "invalid_ident");
    assert.equal(called, false);
  } finally {
    restore();
  }
});
