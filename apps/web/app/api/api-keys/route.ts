import { z } from "zod";
import { createApiKey, listApiKeys } from "../../../lib/api-auth";
import { handle, jsonBody, owner } from "../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const userId = await owner(request);
    return Response.json({ keys: await listApiKeys(userId) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const userId = await owner(request);
    const { name } = z.object({ name: z.string().trim().min(1).max(60).default("API key") })
      .parse(await jsonBody(request));
    const key = await createApiKey(userId, name);
    return Response.json(key, { status: 201 });
  });
}
