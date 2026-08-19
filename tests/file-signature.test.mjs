import test from "node:test";
import assert from "node:assert/strict";

const { looksLikeDeclaredType } = await import("../lib/file-signature.ts");

/**
 * lib/file-signature.ts — the magic-number check shared by
 * expenses/actions.ts and documents/actions.ts. The HEIC/HEIF cases are
 * the point of this file: the old, hand-duplicated version of this
 * function in both call sites checked only the ISOBMFF `ftyp` box tag at
 * offset 4, which is true of every ISOBMFF container (MP4, MOV, M4A,
 * AVIF, 3GP), not specifically HEIC/HEIF. "an MP4 declared as image/heic
 * is accepted" below is exactly that bug, pinned so it cannot come back.
 */

function ftypBytes(majorBrand) {
  // A minimal, realistic ISOBMFF ftyp box: size(4) + "ftyp"(4) +
  // major_brand(4) + minor_version(4) = 16 bytes, matching the 16-byte
  // head both call sites actually read.
  assert.equal(majorBrand.length, 4, "major brand must be exactly 4 chars");
  const brandBytes = [...majorBrand].map((c) => c.charCodeAt(0));
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18, // box size
    0x66, 0x74, 0x79, 0x70, // "ftyp"
    ...brandBytes, // major_brand
    0x00, 0x00, 0x00, 0x00, // minor_version
  ]);
}

test("HEIC/HEIF major_brand — the vulnerability this module exists to fix", async (t) => {
  const HEIF_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"];
  const NON_HEIF_ISOBMFF_BRANDS = ["isom", "mp41", "mp42", "qt  ", "M4A ", "avif", "avis", "3gp4"];

  for (const brand of HEIF_BRANDS) {
    await t.test(`major_brand "${brand}" is accepted as image/heic`, () => {
      assert.equal(looksLikeDeclaredType(ftypBytes(brand), "image/heic"), true);
    });
    await t.test(`major_brand "${brand}" is accepted as image/heif`, () => {
      assert.equal(looksLikeDeclaredType(ftypBytes(brand), "image/heif"), true);
    });
  }

  for (const brand of NON_HEIF_ISOBMFF_BRANDS) {
    await t.test(
      `major_brand "${brand}" is REJECTED as image/heic even though it is a valid ftyp box`,
      () => {
        // This is the regression test: the old check asserted only the
        // "ftyp" tag at offset 4 (true for every one of these files) and
        // never looked at major_brand, so every brand in this list used
        // to pass as image/heic. A caller could set Content-Type:
        // image/heic on an actual MP4/MOV/M4A/AVIF/3GP and it would sail
        // through into the receipts bucket.
        assert.equal(looksLikeDeclaredType(ftypBytes(brand), "image/heic"), false);
        assert.equal(looksLikeDeclaredType(ftypBytes(brand), "image/heif"), false);
      }
    );
  }

  await t.test("something that isn't even an ftyp box is rejected", () => {
    const notFtyp = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0xde, 0xad, 0xbe, 0xef, 0x68, 0x65, 0x69, 0x63]);
    assert.equal(looksLikeDeclaredType(notFtyp, "image/heic"), false);
  });

  await t.test("a truncated buffer with no major_brand bytes at all does not crash", () => {
    const tiny = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    assert.equal(looksLikeDeclaredType(tiny, "image/heic"), false);
    assert.equal(looksLikeDeclaredType(new Uint8Array([]), "image/heic"), false);
  });
});

test("the other accepted formats are unchanged", async (t) => {
  await t.test("JPEG", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(looksLikeDeclaredType(bytes, "image/jpeg"), true);
    assert.equal(looksLikeDeclaredType(bytes, "image/png"), false);
  });

  await t.test("PNG", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    assert.equal(looksLikeDeclaredType(bytes, "image/png"), true);
    assert.equal(looksLikeDeclaredType(bytes, "image/jpeg"), false);
  });

  await t.test("PDF", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    assert.equal(looksLikeDeclaredType(bytes, "application/pdf"), true);
  });

  await t.test("WebP — RIFF....WEBP", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    assert.equal(looksLikeDeclaredType(bytes, "image/webp"), true);
  });

  await t.test("a RIFF file that isn't WEBP (e.g. WAV/AVI) is rejected", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, // "WAVE"
    ]);
    assert.equal(looksLikeDeclaredType(bytes, "image/webp"), false);
  });

  await t.test("an unrecognised declared type is always rejected", () => {
    assert.equal(
      looksLikeDeclaredType(new Uint8Array([0xff, 0xd8, 0xff]), "image/gif"),
      false
    );
  });
});
