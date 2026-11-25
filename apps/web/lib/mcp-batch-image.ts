import sharp from "sharp";
import { HttpError } from "./http";

const PROFILES = [
  { width: 1920, quality: 85 },
  { width: 1920, quality: 72 },
  { width: 1920, quality: 60 },
  { width: 1600, quality: 72 },
  { width: 1440, quality: 65 },
  { width: 1280, quality: 55 },
  { width: 960, quality: 50 },
] as const;

function encodedLength(bytes: Buffer) {
  return 4 * Math.ceil(bytes.length / 3);
}

/** Fit a single evidence image within its share of the MCP Base64 budget.
 * Original stored images are never mutated. Prefer readable HUD detail and
 * avoid enlarging small inputs; each attempt starts from the original.
 */
export async function fitBatchImage(original: Buffer, maxEncodedChars: number) {
  if (encodedLength(original) <= maxEncodedChars)
    return { bytes: original, compressed: false };

  try {
    for (const { width, quality } of PROFILES) {
      const bytes = await sharp(original, { limitInputPixels: 40_000_000 })
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, chromaSubsampling: "4:4:4" })
        .toBuffer();
      if (encodedLength(bytes) <= maxEncodedChars)
        return { bytes, compressed: true };
    }
  } catch {
    throw new HttpError(413, "Frame batch exceeds response budget or image cannot be compressed; retry with fewer frames or use get_frame");
  }
  throw new HttpError(413, "Frame batch exceeds response budget after compression; retry with fewer frames or use get_frame");
}
