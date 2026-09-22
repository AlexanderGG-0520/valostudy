import { auth } from "../../../lib/auth";
import { buildCanonicalMatch } from "../../../lib/studies";
import { handle } from "../../../lib/http";
import { VCMR_SCHEMA_VERSION } from "@valostudy/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await auth().api.getSession({ headers: request.headers });
    const canonical = await buildCanonicalMatch((await context.params).id, session?.user.id);
    const processing = ["pending", "queued", "processing"].includes(canonical.study.status);
    return Response.json(canonical, {
      status: processing ? 202 : 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": `application/vnd.valostudy.vcmr+json; version=${VCMR_SCHEMA_VERSION}; charset=utf-8`,
        "X-Content-Type-Options": "nosniff",
        ...(processing ? { "Retry-After": "5" } : {}),
      },
    });
  });
}
