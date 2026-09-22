import { beforeEach, describe, expect, it, vi } from "vitest";

const id = "31f4c1b8ed3";
const mocks = vi.hoisted(() => ({
  buildPublicAiStudyIndex: vi.fn(),
  buildPublicAiFramePage: vi.fn(),
  readableStudy: vi.fn(),
  db: vi.fn(),
  storageGet: vi.fn(),
  log: vi.fn(),
}));

vi.mock("../apps/web/lib/studies", () => ({
  buildPublicAiStudyIndex: mocks.buildPublicAiStudyIndex,
  buildPublicAiFramePage: mocks.buildPublicAiFramePage,
  readableStudy: mocks.readableStudy,
}));

vi.mock("@valostudy/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  frames: { studyId: "studyId", name: "name" },
  db: mocks.db,
}));

vi.mock("@valostudy/storage", () => ({
  Storage: class {
    get = mocks.storageGet;
  },
}));

vi.mock("@valostudy/config", () => ({
  config: () => ({
    BETTER_AUTH_URL: "https://auth.internal.test",
    PUBLIC_APP_URL: "https://valostudy.alec-ofc.com",
  }),
  log: mocks.log,
}));

import { handleMcpRequest, MCP_TOOLS } from "../apps/web/lib/mcp";

function mockFrame(name: string, timestampMs: number, bytes: number[]) {
  mocks.readableStudy.mockResolvedValue({
    status: "completed",
    framesExpiredAt: null,
  });
  const where = vi.fn().mockResolvedValue([{
    studyId: id,
    name,
    timestampMs,
    objectKey: `frames/${id}/${name}`,
  }]);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  mocks.db.mockReturnValue({ select });
  mocks.storageGet.mockResolvedValue({
    Body: {
      transformToByteArray: vi.fn().mockResolvedValue(Uint8Array.from(bytes)),
    },
  });
}

function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  name?: string,
  options: { capabilities?: unknown; contentType?: string } = {},
) {
  return new Request("https://0.0.0.0:3000/mcp", {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      "accept": "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
          ...(
            options.capabilities === undefined
              ? { "io.modelcontextprotocol/clientCapabilities": {} }
              : { "io.modelcontextprotocol/clientCapabilities": options.capabilities }
          ),
        },
      },
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.buildPublicAiStudyIndex.mockResolvedValue({
    studyId: id,
    player: {
      rank: "Diamond 1",
      sensitivity: { dpi: 1600, inGame: 0.1 },
      videoSettings: {
        resolution: "1920x1080",
        refreshHz: 240,
        fpsLimit: 0,
        vsync: true,
        displayMode: "fullscreen",
        graphics: "Low except material quality",
      },
      context: "test context",
    },
    status: "completed",
    framesExpiredAt: null,
    frameCount: 7072,
    timeline: {
      origin: "video_start",
      unit: "ms",
      durationMs: 1_414_400,
      samplingFps: 5,
      samplingIntervalMs: 200,
      observedStartMs: 0,
      observedEndMs: 1_414_200,
    },
    timestampNote: "Sampling timeline",
    coachingProtocol: { redditResearchRequired: true, promptTemplateVersion: "v1" },
    prompt: "Inspect the entire match and coach the player.",
  });
  mocks.buildPublicAiFramePage.mockResolvedValue({
    studyId: id,
    total: 7072,
    rangeStartMs: null,
    rangeEndMs: null,
    timestampNote: "Sampling timeline",
    frames: [
      { name: "000001.jpg", sampleIndex: 0, timestampMs: 0, url: `/${id}/frames/000001.jpg` },
      { name: "000002.jpg", sampleIndex: 1, timestampMs: 200, url: `/${id}/frames/000002.jpg` },
    ],
  });
});

describe("ValoStudy MCP", () => {
  it("serves modern server/discover with stable public metadata", async () => {
    const response = await handleMcpRequest(modernRequest("server/discover"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.supportedVersions).toEqual(["2026-07-28"]);
    expect(body.result.capabilities).toEqual({ tools: {} });
    expect(body.result.cacheScope).toBe("public");
    expect(body.result.resultType).toBe("complete");
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({
      name: "valostudy",
      version: "1.2.0",
    });
  });

  it("lists five deterministic review-ready read-only tools", async () => {
    const response = await handleMcpRequest(modernRequest("tools/list"));
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_study",
      "get_player_settings",
      "get_coaching_prompt",
      "list_frames",
      "get_frame",
    ]);
    expect(MCP_TOOLS).toHaveLength(5);

    for (const tool of MCP_TOOLS) {
      expect(tool.securitySchemes).toEqual([{ type: "noauth" }]);
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.inputSchema.additionalProperties).toBe(false);
      if (tool.name === "get_frame") {
        expect(tool.outputSchema).toBeUndefined();
      } else {
        expect(tool.outputSchema?.additionalProperties).toBe(false);
      }
    }
  });

  it("returns a narrow Study overview through get_study", async () => {
    const response = await handleMcpRequest(modernRequest(
      "tools/call",
      { name: "get_study", arguments: { study_id: id } },
      "get_study",
    ));
    const body = await response.json();

    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toMatchObject({
      study_id: id,
      status: "completed",
      frame_count: 7072,
      canonical_schema_version: "1.1.0",
      frames_expired_at: null,
      timeline: {
        origin: "video_start",
        unit: "ms",
        duration_ms: 1_414_400,
        sampling_fps: 5,
        sampling_interval_ms: 200,
        observed_start_ms: 0,
        observed_end_ms: 1_414_200,
      },
      manifest_url: `https://valostudy.alec-ofc.com/${id}/manifest.json`,
    });
    expect(body.result.structuredContent.player).toBeUndefined();
    expect(body.result.structuredContent.prompt).toBeUndefined();
    expect(mocks.buildPublicAiStudyIndex).toHaveBeenCalledWith(id);
    expect(mocks.log).toHaveBeenCalledWith("mcp_tool_call", expect.objectContaining({
      tool: "get_study",
      outcome: "ok",
    }));
  });

  it("returns player settings through the dedicated tool", async () => {
    const response = await handleMcpRequest(modernRequest(
      "tools/call",
      { name: "get_player_settings", arguments: { study_id: id } },
      "get_player_settings",
    ));
    const body = await response.json();

    expect(body.result.structuredContent.study_id).toBe(id);
    expect(body.result.structuredContent.player).toMatchObject({
      rank: "Diamond 1",
      sensitivity: { dpi: 1600, inGame: 0.1 },
      videoSettings: { resolution: "1920x1080", refreshHz: 240 },
      context: "test context",
    });
  });

  it("pages frame metadata through tools/call", async () => {
    const response = await handleMcpRequest(modernRequest(
      "tools/call",
      { name: "list_frames", arguments: { study_id: id, offset: 240, limit: 2 } },
      "list_frames",
    ));
    const body = await response.json();
    expect(body.result.structuredContent.frames[0]).toEqual({
      frame_name: "000001.jpg",
      sample_index: 0,
      timestamp_ms: 0,
      url: `https://valostudy.alec-ofc.com/${id}/frames/000001.jpg`,
    });
    expect(mocks.buildPublicAiFramePage).toHaveBeenCalledWith(id, 240, 2, undefined, undefined);
  });

  it("filters frame metadata by canonical timeline range", async () => {
    mocks.buildPublicAiFramePage.mockResolvedValueOnce({
      studyId: id,
      total: 2,
      rangeStartMs: 60_000,
      rangeEndMs: 90_000,
      timestampNote: "Sampling timeline",
      frames: [
        { name: "000301.jpg", sampleIndex: 300, timestampMs: 60_000, url: `/${id}/frames/000301.jpg` },
      ],
    });
    const response = await handleMcpRequest(modernRequest(
      "tools/call",
      { name: "list_frames", arguments: { study_id: id, start_ms: 60_000, end_ms: 90_000, limit: 120 } },
      "list_frames",
    ));
    const body = await response.json();
    expect(body.result.structuredContent).toMatchObject({
      range_start_ms: 60_000,
      range_end_ms: 90_000,
      frames: [{ frame_name: "000301.jpg", sample_index: 300, timestamp_ms: 60_000 }],
    });
    expect(mocks.buildPublicAiFramePage).toHaveBeenCalledWith(id, 0, 120, 60_000, 90_000);
  });

  it("returns JPEG bytes as MCP image content and never uses the bind origin", async () => {
    mockFrame("003000.jpg", 599800, [0xff, 0xd8, 0xff, 0xd9]);

    const response = await handleMcpRequest(modernRequest(
      "tools/call",
      { name: "get_frame", arguments: { study_id: id, frame_name: "003000.jpg" } },
      "get_frame",
    ));
    const body = await response.json();

    expect(body.result.resultType).toBe("complete");
    expect(body.result.structuredContent).toBeUndefined();
    expect(body.result.content[0]).toEqual({
      type: "image",
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
      mimeType: "image/jpeg",
    });
    expect(JSON.parse(body.result.content[1].text)).toEqual({
      study_id: id,
      frame_name: "003000.jpg",
      sample_index: 2999,
      timestamp_ms: 599800,
      mime_type: "image/jpeg",
      url: `https://valostudy.alec-ofc.com/${id}/frames/003000.jpg`,
    });
    expect(body.result.content[1].text).not.toContain("0.0.0.0");
  });

  it("returns WebP bytes as MCP image content", async () => {
    mockFrame("003001.webp", 600000, [0x52, 0x49, 0x46, 0x46]);

    const response = await handleMcpRequest(modernRequest(
      "tools/call",
      { name: "get_frame", arguments: { study_id: id, frame_name: "003001.webp" } },
      "get_frame",
    ));
    const body = await response.json();

    expect(body.result.content[0]).toEqual({
      type: "image",
      data: Buffer.from([0x52, 0x49, 0x46, 0x46]).toString("base64"),
      mimeType: "image/webp",
    });
    expect(JSON.parse(body.result.content[1].text)).toMatchObject({
      study_id: id,
      frame_name: "003001.webp",
      sample_index: 3000,
      timestamp_ms: 600000,
      mime_type: "image/webp",
    });
  });

  it("supports the 2025 initialize handshake as a compatibility fallback", async () => {
    const request = new Request("https://0.0.0.0:3000/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-test", version: "1.0.0" },
        },
      }),
    });
    const response = await handleMcpRequest(request);
    const body = await response.json();
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.serverInfo).toEqual({ name: "valostudy", version: "1.2.0" });
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it("rejects modern header/body routing mismatches", async () => {
    const request = modernRequest(
      "tools/call",
      { name: "get_study", arguments: { study_id: id } },
      "wrong_tool",
    );
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe(-32020);
  });

  it("rejects a modern request without client capabilities", async () => {
    const request = modernRequest("server/discover", {}, undefined, { capabilities: null });
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe(-32020);
    expect(body.error.message).toMatch(/client capabilities/i);
  });

  it("rejects non-JSON POSTs before parsing", async () => {
    const request = new Request("https://0.0.0.0:3000/mcp", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body.error.code).toBe(-32600);
  });

  it("keeps private or missing Studies as bounded tool errors", async () => {
    mocks.buildPublicAiStudyIndex.mockRejectedValueOnce(new Error("not public"));
    const response = await handleMcpRequest(modernRequest(
      "tools/call",
      { name: "get_study", arguments: { study_id: id } },
      "get_study",
    ));
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toBeUndefined();
    expect(body.result.content).toEqual([{ type: "text", text: "Tool execution failed" }]);
    expect(mocks.log).toHaveBeenCalledWith("mcp_tool_call", expect.objectContaining({
      tool: "get_study",
      outcome: "error",
      status: 500,
    }));
  });
});
