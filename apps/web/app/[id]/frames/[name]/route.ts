import { auth } from "../../../../lib/auth";
import { readableStudy } from "../../../../lib/studies";
import { handle, HttpError } from "../../../../lib/http";
import { frameNameSchema } from "@valostudy/schema";
import { db, frames, and, eq } from "@valostudy/db";
import { Storage } from "@valostudy/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string; name: string }> }) {
  return handle(async () => {
    const { id, name } = await context.params;
    if (!frameNameSchema.safeParse(name).success) throw new HttpError(404, "Frame not found");
    const session = await auth().api.getSession({ headers: request.headers });
    const study = await readableStudy(id, session?.user.id);
    if (!study || study.status !== "completed") throw new HttpError(404, "Frame not found");
    const [frame] = await db().select().from(frames).where(and(eq(frames.studyId, id), eq(frames.name, name)));
    if (!frame) throw new HttpError(404, "Frame not found");
    const object = await new Storage().get(frame.objectKey);
    if (!object.Body) throw new HttpError(404, "Frame not found");
    const contentType = name.endsWith(".jpg") ? "image/jpeg" : "image/webp";
    return new Response(object.Body.transformToWebStream(), { headers: {
      "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  });
}
