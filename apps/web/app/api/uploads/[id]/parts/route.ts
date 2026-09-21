import { MAX_UPLOAD_PARTS } from "@valostudy/schema";
import { Storage, partSize } from "@valostudy/storage";
import { handle, owner, HttpError, jsonBody } from "../../../../../lib/http";
import { ownedUpload } from "../../../../../lib/studies";
import { z } from "zod";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ownerId = await owner(request);
    const { id } = await context.params;
    const { partNumber } = z.object({
      partNumber: z.number().int().positive().max(MAX_UPLOAD_PARTS),
    }).parse(await jsonBody(request));

    const upload = await ownedUpload(id, ownerId);
    const remaining = Math.floor((upload.expiresAt.getTime() - Date.now()) / 1000);
    if (remaining <= 0 || upload.completedAt) throw new HttpError(410, "Upload expired or completed");

    let size: number;
    try {
      size = partSize(upload.expectedBytes, partNumber);
    } catch {
      throw new HttpError(400, "Part out of range");
    }

    const url = await new Storage().partUrl(
      upload.objectKey,
      upload.uploadId,
      partNumber,
      size,
      Math.min(900, remaining),
    );
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  }, { requestOperation: "upload.part_url" });
}
