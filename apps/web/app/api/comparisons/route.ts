import { z } from "zod";
import { handle, jsonBody, owner } from "../../../lib/http";
import { createComparison } from "../../../lib/comparisons";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const ownerId = await owner(request);
    const input = z.object({
      studyIds: z.array(z.string()).min(2).max(100),
      visibility: z.enum(["private", "public"]).default("private"),
    }).parse(await jsonBody(request));
    const comparison = await createComparison(ownerId, input.studyIds, input.visibility);
    return Response.json({
      comparisonId: comparison.id,
      url: `/compare/${comparison.id}`,
      manifestUrl: `/compare/${comparison.id}/manifest.json`,
    }, { status: 201 });
  });
}
