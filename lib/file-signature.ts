/**
 * MAGIC-NUMBER CHECK for an uploaded file — cheap, and a different
 * guarantee than lib/receipt-image.ts's decode gate.
 *
 * `file.type` is whatever the browser (or, trivially, a scripted
 * multipart POST) declared, and the `receipts` bucket's
 * `allowed_mime_types` policy validates that same client-declared header —
 * neither layer reads a single byte of the body. That is not a
 * tenant-isolation hole (Storage serves from a different origin than the
 * app, so a mislabelled payload cannot reach app cookies), but it does
 * mean arbitrary content can sit in a private bucket labelled
 * `image/png`. This closes that gap for the formats expenses/actions.ts
 * and documents/actions.ts accept, by checking the file's actual leading
 * bytes against what its declared type requires.
 *
 * WHY THIS DOES NOT LIVE NEXT TO decodeEmbeddableReceipt
 * (lib/receipt-image.ts, "THE DECODE GATE"). That module proves a
 * JPEG/PNG can be DECODED — every pixel, via sharp — and runs AFTER a
 * file is already in storage, for exactly the two formats react-pdf can
 * embed. This runs BEFORE the upload, for every accepted format
 * including PDF and WebP, and proves nothing about decodability: a
 * byte-valid-looking JPEG header can still front truncated garbage,
 * which is precisely the gap the decode gate exists to close later.
 * Folding a cheap pre-upload sniff into a module whose entire framing is
 * "the one place a receipt's bytes are proved to be a real image" would
 * misrepresent what this check actually establishes.
 *
 * WHY THIS IS SHARED. It was a hand-duplicated function in
 * expenses/actions.ts and documents/actions.ts, and the copies had
 * already drifted: the HEIC/HEIF branch checked only the ISOBMFF `ftyp`
 * box tag at offset 4, which every ISOBMFF file has — MP4, MOV, M4A,
 * AVIF, 3GP, not HEIC/HEIF specifically — so a caller declaring
 * `image/heic` on an arbitrary MP4 passed. One fix, one place, both
 * callers.
 */

function startsWith(bytes: Uint8Array, offset: number, ...sig: number[]): boolean {
  return sig.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * ISOBMFF FileTypeBox ("ftyp") layout — ISO/IEC 14496-12 §4.3, the box
 * every HEIC/HEIF file opens with, and also the box every OTHER ISOBMFF
 * file (MP4, MOV, M4A, AVIF, 3GP) opens with:
 *
 *   bytes 0-3   box size (uint32 BE)
 *   bytes 4-7   box type, ASCII "ftyp"
 *   bytes 8-11  major_brand — the file's OWN declaration of what it is
 *   bytes 12-15 minor_version (uint32)
 *   bytes 16+   compatible_brands — one 4-char code per 4 bytes, to the
 *               end of the box
 *
 * The HEIF spec (ISO/IEC 23008-12) and the IANA registrations for
 * image/heic and image/heif each define a fixed, small brand list:
 *   - heic, heix, heim, heis — a single HEVC-coded image (four profile
 *     variants: main, extended-range/10-bit, multiview, scalable)
 *   - hevc, hevx — an HEVC-coded image SEQUENCE (bursts, Live Photos)
 *   - mif1, msf1 — the generic, codec-agnostic HEIF structural brands,
 *     for a single image and a sequence respectively (some encoders,
 *     e.g. libheif, emit one of these as major_brand with the specific
 *     codec brand only in compatible_brands)
 * None of those eight codes is a major_brand any ordinary MP4/MOV/M4A/
 * AVIF/3GP file uses — those are isom, mp41, mp42, qt  , M4A , M4V ,
 * avif, avis, 3gp4, 3gp5, and similar. Checking major_brand against this
 * list is exactly "reject every other ISOBMFF container," which is the
 * gap the old ftyp-only check left open.
 *
 * DELIBERATELY NOT WALKING compatible_brands (offset 16+) to decide
 * acceptance. It is exactly as attacker-writable as every other byte in
 * the file: a file whose major_brand is "mp42" could trivially also list
 * "heic" among its compatible brands while remaining an ordinary MP4 for
 * whatever actually decodes it. Treating compatible_brands membership as
 * sufficient would make this check WEAKER than checking major_brand
 * alone, not stronger — it would hand back the exact bypass this module
 * exists to close, just moved sixteen bytes to the right. major_brand is
 * the file's one required, unambiguous self-identification, so that is
 * the only field consulted.
 */
const HEIF_MAJOR_BRANDS: readonly number[][] = [
  [0x68, 0x65, 0x69, 0x63], // "heic"
  [0x68, 0x65, 0x69, 0x78], // "heix"
  [0x68, 0x65, 0x69, 0x6d], // "heim"
  [0x68, 0x65, 0x69, 0x73], // "heis"
  [0x68, 0x65, 0x76, 0x63], // "hevc"
  [0x68, 0x65, 0x76, 0x78], // "hevx"
  [0x6d, 0x69, 0x66, 0x31], // "mif1"
  [0x6d, 0x73, 0x66, 0x31], // "msf1"
];

function hasHeifMajorBrand(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, 4, 0x66, 0x74, 0x79, 0x70)) return false; // "ftyp"
  return HEIF_MAJOR_BRANDS.some((brand) => startsWith(bytes, 8, ...brand));
}

/**
 * Checks the file's actual leading bytes against its declared
 * Content-Type. `bytes` only needs to cover the file's first 16 bytes —
 * every signature checked here, including the HEIC/HEIF major brand at
 * offset 8-11, fits inside that window. Callers are expected to have
 * already checked `type` against their own accepted-type list; this
 * function answers "do the bytes match," not "is this type allowed
 * here," and returns `false` (not an error) for a type it does not
 * recognise at all.
 */
export function looksLikeDeclaredType(bytes: Uint8Array, type: string): boolean {
  switch (type) {
    case "image/jpeg":
      return startsWith(bytes, 0, 0xff, 0xd8, 0xff);
    case "image/png":
      return startsWith(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "application/pdf":
      return startsWith(bytes, 0, 0x25, 0x50, 0x44, 0x46); // %PDF
    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        startsWith(bytes, 0, 0x52, 0x49, 0x46, 0x46) &&
        startsWith(bytes, 8, 0x57, 0x45, 0x42, 0x50)
      );
    case "image/heic":
    case "image/heif":
      // Same ISOBMFF container for both — which of the two a browser
      // reports for the same iPhone photo is not something this app gets
      // to decide — but the major_brand test above is real, unlike the
      // old ftyp-only check.
      return hasHeifMajorBrand(bytes);
    default:
      return false;
  }
}
