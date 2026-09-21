import { handle, owner } from "../../../../lib/http";
import { billingStatus } from "../../../../lib/billing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const userId = await owner(request);
    return Response.json(await billingStatus(userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
