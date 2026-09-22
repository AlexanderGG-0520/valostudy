import { and, db, eq, frames } from "@valostudy/db";
import { frameNameSchema, studyIdSchema } from "@valostudy/schema";
import { Storage } from "@valostudy/storage";
import { buildPublicAiFramePage, buildPublicAiStudyIndex, readableStudy } from "./studies";
import { HttpError } from "./http";

const MODERN_PROTOCOL = "2026-07-28";
const LEGACY_PROTOCOL = "2025-11-25";
const SERVER_INFO = { name: "valostudy", version: "1.0.0" };
const INSTRUCTIONS = [
  "ValoStudy exposes public VALORANT Study data for read-only coaching analysis.",
  "Call get_study first, then read player settings and coaching prompt before inspecting frame evidence.",
  "Use list_frames to page through frame metadata and get_frame to retrieve selected JPEG/WebP images directly through MCP.",
  "Only public Studies are available from this endpoint.",
].join(" ");

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
};

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const STUDY_ID_PROPERTY = {
  type: "string",
  pattern: "^[0-9a-f]{11}$",
  description: "ValoStudy 11-character lowercase hexadecimal Study ID.",
};

export const MCP_TOOLS: ToolDefinition[] = [
  {
    name: "get_study",
    title: "Get ValoStudy Study",
    description: "Get a public Study summary including player settings, coaching protocol, coaching prompt, frame count, and canonical resource URLs.",
    inputSchema: {
      type: "object",
      properties: { study_id: STUDY_ID_PROPERTY },
      required: ["study_id"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: READ_ONLY,
  },
  {
    name: "get_player_settings",
    title: "Get player settings",
    description: "Get the player rank, sensitivity, video settings, and user-provided context for a public Study.",
    inputSchema: {
      type: "object",
      properties: { study_id: STUDY_ID_PROPERTY },
      required: ["study_id"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: READ_ONLY,
  },
  {
    name: "get_coaching_prompt",
    title: "Get coaching prompt",
    description: "Get the immutable coaching prompt snapshot and protocol metadata for a public Study.",
    inputSchema: {
      type: "object",
      properties: { study_id: STUDY_ID_PROPERTY },
      required: ["study_id"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: READ_ONLY,
  },
  {
    name: "list_frames",
    title: "List frame evidence",
    description: "Page through frame evidence metadata for a completed public Study. Use the returned frame_name with get_frame.",
    inputSchema: {
      type: "object",
      properties: {
        study_id: STUDY_ID_PROPERTY,
        offset: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 240, default: 120 },
      },
      required: ["study_id"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: READ_ONLY,
  },
  {
    name: "get_frame",
    title: "Get frame image",
    description: "Retrieve one frame image from a completed public Study directly as MCP image content, without requiring the AI client to fetch the frame URL.",
    inputSchema: {
      type: "object",
      properties: {
        study_id: STUDY_ID_PROPERTY,
        frame_name: {
          type: "string",
          pattern: "^\\d{6}\\.(?:jpg|webp)$",
          description: "Frame filename returned by list_frames, for example 000241.jpg.",
        },
      },
      required: ["study_id", "frame_name"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        study_id: { type: "string" },
        frame_name: { type: "string" },
        timestamp_ms: { type: "integer" },
        mime_type: { type: "string" },
        url: { type: "string" },
      },
      required: ["study_id", "frame_name", "timestamp_ms", "mime_type", "url"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

function withServerMeta<T extends Record<string, unknown>>(result: T, modern: boolean) {
  if (!modern) return result;
  return {
    ...result,
    _meta: {
      ...(typeof result._meta === "object" && result._meta ? result._meta : {}),
      "io.modelcontextprotocol/serverInfo": SERVER_INFO,
    },
  };
}

function rpcResult(id: JsonRpcId, result: Record<string, unknown>, modern: boolean) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: withServerMeta(result, modern),
  }, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function rpcError(id: JsonRpcId, code: number, message: string, modern: boolean, data?: unknown, status = 200) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
    ...(modern ? {
      _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
    } : {}),
  }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function paramsObject(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
}

function stringArgument(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string") throw new HttpError(400, `${key} is required`);
  return value;
}

function studyIdArgument(args: Record<string, unknown>) {
  const id = stringArgument(args, "study_id");
  if (!studyIdSchema.safeParse(id).success) throw new HttpError(400, "Invalid study_id");
  return id;
}

function intArgument(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = args[key] ?? fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
    throw new HttpError(400, `Invalid ${key}`);
  return value as number;
}

function absoluteUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}

function textToolResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

async function publicFrame(id: string, name: string, origin: string) {
  if (!frameNameSchema.safeParse(name).success) throw new HttpError(400, "Invalid frame_name");
  const study = await readableStudy(id);
  if (!study || study.status !== "completed" || study.framesExpiredAt)
    throw new HttpError(404, "Frame not found");

  const [frame] = await db().select().from(frames).where(and(
    eq(frames.studyId, id),
    eq(frames.name, name),
  ));
  if (!frame) throw new HttpError(404, "Frame not found");

  const object = await new Storage().get(frame.objectKey);
  if (!object.Body) throw new HttpError(404, "Frame not found");
  const bytes = await object.Body.transformToByteArray();
  const mimeType = name.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  const metadata = {
    study_id: id,
    frame_name: name,
    timestamp_ms: frame.timestampMs,
    mime_type: mimeType,
    url: absoluteUrl(origin, `/${id}/frames/${name}`),
  };

  return {
    content: [
      { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType },
      { type: "text", text: JSON.stringify(metadata) },
    ],
    structuredContent: metadata,
  };
}

async function callTool(name: string, args: Record<string, unknown>, origin: string) {
  switch (name) {
    case "get_study": {
      const id = studyIdArgument(args);
      const study = await buildPublicAiStudyIndex(id);
      return textToolResult({
        ...study,
        ai_url: absoluteUrl(origin, `/ai/${id}`),
        manifest_url: absoluteUrl(origin, `/${id}/manifest.json`),
        canonical_url: absoluteUrl(origin, `/${id}/canonical.json`),
        mcp_url: absoluteUrl(origin, "/mcp"),
      });
    }
    case "get_player_settings": {
      const id = studyIdArgument(args);
      const study = await buildPublicAiStudyIndex(id);
      return textToolResult({ study_id: id, player: study.player });
    }
    case "get_coaching_prompt": {
      const id = studyIdArgument(args);
      const study = await buildPublicAiStudyIndex(id);
      return textToolResult({
        study_id: id,
        coaching_protocol: study.coachingProtocol,
        prompt: study.prompt,
      });
    }
    case "list_frames": {
      const id = studyIdArgument(args);
      const offset = intArgument(args, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = intArgument(args, "limit", 120, 1, 240);
      const page = await buildPublicAiFramePage(id, offset, limit);
      return textToolResult({
        study_id: id,
        total: page.total,
        offset,
        limit,
        timestamp_note: page.timestampNote,
        frames: page.frames.map((frame) => ({
          frame_name: frame.name,
          timestamp_ms: frame.timestampMs,
          url: absoluteUrl(origin, frame.url),
        })),
      });
    }
    case "get_frame": {
      const id = studyIdArgument(args);
      const frameName = stringArgument(args, "frame_name");
      return publicFrame(id, frameName, origin);
    }
    default:
      throw new HttpError(404, "Unknown tool");
  }
}

function modernFrom(request: Request, body: JsonRpcRequest) {
  const params = paramsObject(body.params);
  const meta = params._meta;
  const metaVersion = meta && typeof meta === "object"
    ? (meta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"]
    : undefined;
  return request.headers.get("mcp-protocol-version") === MODERN_PROTOCOL || metaVersion === MODERN_PROTOCOL;
}

function validateModernHeaders(request: Request, method: string, params: Record<string, unknown>) {
  if (request.headers.get("mcp-protocol-version") !== MODERN_PROTOCOL)
    throw new HttpError(400, "Missing or unsupported MCP-Protocol-Version");
  if (request.headers.get("mcp-method") !== method)
    throw new HttpError(400, "Mcp-Method header mismatch");
  const expectedName = method === "tools/call" && typeof params.name === "string" ? params.name : null;
  if (expectedName && request.headers.get("mcp-name") !== expectedName)
    throw new HttpError(400, "Mcp-Name header mismatch");
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  let body: JsonRpcRequest;
  try {
    body = await request.json() as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error", false, undefined, 400);
  }

  const id = body.id ?? null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string")
    return rpcError(id, -32600, "Invalid Request", false, undefined, 400);

  const params = paramsObject(body.params);
  const modern = modernFrom(request, body);
  if (modern) {
    try {
      validateModernHeaders(request, body.method, params);
    } catch (error) {
      return rpcError(
        id,
        -32020,
        error instanceof Error ? error.message : "MCP header mismatch",
        true,
        undefined,
        400,
      );
    }
  }

  try {
    if (body.method === "server/discover") {
      if (!modern)
        return rpcError(id, -32601, "Method not found", false);
      return rpcResult(id, {
        supportedVersions: [MODERN_PROTOCOL],
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ttlMs: 3_600_000,
        cacheScope: "public",
      }, true);
    }

    if (body.method === "initialize") {
      if (modern)
        return rpcError(id, -32601, "Method not found", true);
      return rpcResult(id, {
        protocolVersion: LEGACY_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      }, false);
    }

    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });

    if (body.method === "ping")
      return rpcResult(id, {}, modern);

    if (body.method === "tools/list") {
      return rpcResult(id, {
        tools: MCP_TOOLS,
        ...(modern ? { ttlMs: 3_600_000, cacheScope: "public" } : {}),
      }, modern);
    }

    if (body.method === "tools/call") {
      const name = params.name;
      const args = params.arguments;
      if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args))
        return rpcError(id, -32602, "Invalid tool call parameters", modern);

      try {
        const result = await callTool(name, args as Record<string, unknown>, new URL(request.url).origin);
        return rpcResult(id, result, modern);
      } catch (error) {
        const message = error instanceof HttpError
          ? error.message
          : "Tool execution failed";
        const status = error instanceof HttpError ? error.status : 500;
        return rpcResult(id, {
          content: [{ type: "text", text: message }],
          isError: true,
          structuredContent: { error: message, status },
        }, modern);
      }
    }

    return rpcError(id, -32601, "Method not found", modern);
  } catch {
    return rpcError(id, -32603, "Internal error", modern);
  }
}
