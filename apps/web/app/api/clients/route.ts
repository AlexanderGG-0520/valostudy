import { z } from "zod";
import { createClient, listClients } from "../../../lib/workspace";
import { handle, jsonBody, owner } from "../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const ownerId = await owner(request);
    return Response.json({ clients: await listClients(ownerId) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const ownerId = await owner(request);
    const input = z.object({
      displayName: z.string().trim().min(1).max(100),
      riotId: z.string().trim().max(100).nullable().optional(),
      notes: z.string().trim().max(2000).optional(),
    }).parse(await jsonBody(request));
    const client = await createClient(ownerId, input);
    return Response.json({ id: client.id, url: `/clients/${client.id}` }, { status: 201 });
  });
}
