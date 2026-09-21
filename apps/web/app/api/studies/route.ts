import { studyCreationSchema, PART_BYTES } from "@valostudy/schema";
import { handle, jsonBody, owner } from "../../../lib/http";
import { createStudy } from "../../../lib/studies";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => {
    const ownerId = await owner(request);
    const input = studyCreationSchema.parse(await jsonBody(request));
    const study = await createStudy(ownerId, input);
    return Response.json({ studyId: study.id, url: `/${study.id}`, partBytes: PART_BYTES,
      partCount: Math.ceil(input.video.size / PART_BYTES) }, { status: 201 });
  }, { requestOperation: "study.create" });
}
