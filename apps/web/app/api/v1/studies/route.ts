import { apiOwner } from "../../../../lib/api-auth";
import { listOwnedStudies } from "../../../../lib/comparisons";
import { handle } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const userId = await apiOwner(request);
    return Response.json({
      object: "list",
      data: await listOwnedStudies(userId),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
