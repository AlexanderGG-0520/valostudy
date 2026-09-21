import { apiOwner } from "../../../../lib/api-auth";
import { listClients } from "../../../../lib/workspace";
import { handle } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const ownerId = await apiOwner(request);
    return Response.json({ object: "list", data: await listClients(ownerId) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
