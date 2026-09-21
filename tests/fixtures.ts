import { studyCreationSchema, manifestSchema } from "@valostudy/schema";

export const id = "3fa91bc72de";

export const input = studyCreationSchema.parse({
  player: {
    rank: "Platinum 3",
    sensitivity: { dpi: 1600, inGame: 0.1 },
    videoSettings: {
      resolution: "1920x1080",
      refreshHz: 144,
      fpsLimit: 0,
      vsync: false,
      displayMode: "fullscreen",
      graphics: "Low / Reflex ON",
    },
    context: "<script>alert(1)</script>",
  },
  visibility: "public",
  video: { size: 1234, mimeType: "video/mp4" },
  processing: { fps: 1 },
});

export const manifest = manifestSchema.parse({
  schemaVersion: 1,
  studyId: id,
  player: input.player,
  status: "completed",
  frames: [{ timestampMs: 500, url: `/${id}/frames/000001.webp` }],
  timestampNote: "Sampling timeline; timestamps are approximate, not original frame PTS.",
  coachingProtocol: { redditResearchRequired: true, promptTemplateVersion: "v1" },
  prompt: "Read Reddit and inspect frames",
});
