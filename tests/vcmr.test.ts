import { describe, expect, it } from "vitest";
import {
  VCMR_SCHEMA,
  VCMR_SCHEMA_VERSION,
  VCMR_TIMESTAMP_SEMANTICS,
  vcmrExtractionSchema,
  vcmrMatchSchema,
} from "@valostudy/schema";

const player = {
  rank: "Platinum 3",
  sensitivity: { dpi: 1600, inGame: 0.1 },
  videoSettings: {
    resolution: "1920x1080",
    refreshHz: 240,
    fpsLimit: 0,
    vsync: false,
    displayMode: "fullscreen",
    graphics: "Low / Reflex ON",
  },
  context: "",
} as const;

describe("VCMR", () => {
  it("defines a stable canonical extraction contract", () => {
    const result = vcmrExtractionSchema.parse({
      schema: VCMR_SCHEMA,
      schemaVersion: VCMR_SCHEMA_VERSION,
      media: {
        width: 1920,
        height: 1080,
        durationMs: 1250,
        sampling: {
          fps: 2,
          strategy: "fixed_rate",
          timestampSemantics: VCMR_TIMESTAMP_SEMANTICS,
        },
      },
      frames: [{
        id: "frame_000001",
        name: "000001.jpg",
        timestampMs: 0,
        source: { kind: "fixed_rate_sampling", approximateTimestamp: true },
      }],
      rounds: [],
      events: [],
      annotations: [],
    });

    expect(result.schema).toBe("valostudy.vcmr");
    expect(result.schemaVersion).toBe("1.0.0");
  });

  it("rejects frame identity drift", () => {
    expect(() => vcmrExtractionSchema.parse({
      schema: VCMR_SCHEMA,
      schemaVersion: VCMR_SCHEMA_VERSION,
      media: {
        width: 1920,
        height: 1080,
        durationMs: 1000,
        sampling: {
          fps: 1,
          strategy: "fixed_rate",
          timestampSemantics: VCMR_TIMESTAMP_SEMANTICS,
        },
      },
      frames: [{
        id: "frame_000002",
        name: "000001.jpg",
        timestampMs: 0,
        source: { kind: "fixed_rate_sampling", approximateTimestamp: true },
      }],
      rounds: [],
      events: [],
      annotations: [],
    })).toThrow();
  });

  it("keeps future semantic layers explicit even when v1 cannot detect them yet", () => {
    const result = vcmrMatchSchema.parse({
      schema: VCMR_SCHEMA,
      schemaVersion: VCMR_SCHEMA_VERSION,
      study: {
        id: "3fa91bc72de",
        game: "valorant",
        visibility: "private",
        status: "completed",
        createdAt: "2026-09-22T00:00:00.000Z",
        completedAt: "2026-09-22T00:01:00.000Z",
      },
      player,
      media: {
        width: 1920,
        height: 1080,
        durationMs: 1000,
        sampling: {
          fps: 1,
          strategy: "fixed_rate",
          timestampSemantics: VCMR_TIMESTAMP_SEMANTICS,
        },
      },
      processing: { progress: null, framesExpiredAt: null },
      frames: [{
        id: "frame_000001",
        name: "000001.jpg",
        timestampMs: 0,
        url: "/3fa91bc72de/frames/000001.jpg",
        source: { kind: "fixed_rate_sampling", approximateTimestamp: true },
      }],
      rounds: [],
      events: [],
      annotations: [],
      coaching: {
        protocol: { redditResearchRequired: true, promptTemplateVersion: "v1" },
        prompt: "Coach this match.",
      },
    });

    expect(result.rounds).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.annotations).toEqual([]);
  });
});
