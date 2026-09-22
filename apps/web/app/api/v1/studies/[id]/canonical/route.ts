import { apiOwner } from "../../../../../../lib/api-auth";
import { buildCanonicalMatch } from "../../../../../../lib/studies";
import { handle } from "../../../../../../lib/http";
import { VCMR_SCHEMA_VERSION } from "@valostudy/schema";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = await apiOwner(request);
    const canonical = await buildCanonicalMatch((await context.params).id, userId);
    return Response.json(canonical, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": `application/vnd.valostudy.vcmr+json; version=${VCMR_SCHEMA_VERSION}; charset=utf-8`,
      },
    });
  });
}
