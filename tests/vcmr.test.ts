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
      timeline: {
        origin: "video_start",
        unit: "ms",
        frameOrdering: "sample_index",
        durationMs: 1250,
        samplingIntervalMs: 500,
        frameCount: 1,
        observedRange: { startMs: 0, endMs: 0 },
        coverage: { expectedFrameCount: 3, observedFrameCount: 1, complete: false },
      },
      frames: [{
        id: "frame_000001",
        name: "000001.jpg",
        sampleIndex: 0,
        timestampMs: 0,
        source: { kind: "fixed_rate_sampling", approximateTimestamp: true },
      }],
      rounds: [],
      events: [],
      annotations: [],
    });

    expect(result.schema).toBe("valostudy.vcmr");
    expect(result.schemaVersion).toBe("1.1.0");
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
      timeline: {
        origin: "video_start",
        unit: "ms",
        frameOrdering: "sample_index",
        durationMs: 1000,
        samplingIntervalMs: 1000,
        frameCount: 1,
        observedRange: { startMs: 0, endMs: 0 },
        coverage: { expectedFrameCount: 1, observedFrameCount: 1, complete: true },
      },
      frames: [{
        id: "frame_000002",
        name: "000001.jpg",
        sampleIndex: 0,
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
      timeline: {
        origin: "video_start",
        unit: "ms",
        frameOrdering: "sample_index",
        durationMs: 1000,
        samplingIntervalMs: 1000,
        frameCount: 1,
        observedRange: { startMs: 0, endMs: 0 },
        coverage: { expectedFrameCount: 1, observedFrameCount: 1, complete: true },
      },
      frames: [{
        id: "frame_000001",
        name: "000001.jpg",
        sampleIndex: 0,
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
    expect(result.timeline).toMatchObject({
      origin: "video_start",
      samplingIntervalMs: 1000,
      observedRange: { startMs: 0, endMs: 0 },
      coverage: { complete: true },
    });
  });

  it("rejects temporal metadata that drifts from sampled evidence", () => {
    expect(() => vcmrMatchSchema.parse({
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
      timeline: {
        origin: "video_start",
        unit: "ms",
        frameOrdering: "sample_index",
        durationMs: 1000,
        samplingIntervalMs: 500,
        frameCount: 2,
        observedRange: { startMs: 0, endMs: 500 },
        coverage: { expectedFrameCount: 1, observedFrameCount: 2, complete: false },
      },
      frames: [{
        id: "frame_000001",
        name: "000001.jpg",
        sampleIndex: 0,
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
    })).toThrow();
  });
});
