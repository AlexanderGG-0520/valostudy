# VCMR v1.1 — ValoStudy Canonical Match Representation

VCMR is ValoStudy's model-independent representation of a VALORANT Study.

The canonical contract is defined in `@valostudy/schema` by `vcmrMatchSchema`.
It is intentionally independent from ChatGPT, Claude, Gemini, local VLMs, or any
specific model vendor.

## Contract identity

- Schema: `valostudy.vcmr`
- Version: `1.1.0`
- Media type: `application/vnd.valostudy.vcmr+json; version=1.1.0`

Schema versions follow semantic-versioning rules:

- patch: validation/documentation fixes that do not change accepted meaning
- minor: backward-compatible additive fields or enum values
- major: incompatible field or semantic changes

Consumers must use `schema` and `schemaVersion`; they must not infer a VCMR
version from an application release.

## v1 canonical layers

VCMR v1 contains the data ValoStudy can currently produce reliably:

- Study identity, lifecycle state, visibility, and VALORANT game identity
- player rank, sensitivity, video settings, and user coaching context
- probed media width, height, and duration when available
- fixed-rate sampling configuration and timestamp semantics
- an explicit canonical timeline rooted at `video_start`
- deterministic sampling interval, frame ordering, observed time range, and evidence coverage
- sampled frame evidence with stable IDs, zero-based `sampleIndex`, timestamps, URLs, and provenance
- processing progress and frame-retention state
- immutable coaching prompt snapshot and protocol version

The schema also reserves `rounds`, `events`, and `annotations` as typed,
versioned semantic layers. They are empty in the current extractor rather than
being guessed from video. Future OCR/CV/VLM/replay detectors can populate them
without replacing the representation.

VCMR 1.1 makes those semantic layers explicitly temporal. Rounds can reference
their start/end evidence frames and freeze-end time, events can represent either
an instant or a span through `timestampMs` / `endTimestampMs`, and annotations
can cover a time span as well as one or more evidence frames. Schema validation
rejects inverted spans and references to nonexistent frame IDs.

## Data flow

```text
raw video
  -> ffprobe / ffmpeg
  -> VCMR extraction fragment
  -> normalized PostgreSQL + object storage
  -> VCMR match document
  -> legacy manifest projection / AI adapters
```

VCMR is the source representation. The existing `manifest.json` contract is
kept as a backward-compatible projection and must not become a second source of
truth.

The Worker does not persist a duplicate multi-megabyte VCMR JSON blob. Frame
rows remain normalized in PostgreSQL and JPEG bytes remain in object storage;
the canonical document is assembled deterministically from those normalized
records. This avoids duplicating up to tens of thousands of frame entries.

## Endpoints

Session/public visibility rules:

```text
GET /{studyId}/canonical.json
```

Pro API-key access:

```text
GET /api/v1/studies/{studyId}/canonical
```

The existing endpoints remain available:

```text
GET /{studyId}/manifest.json
GET /api/v1/studies/{studyId}/manifest
```

## Stable frame identity

A sampled frame named `000123.jpg` has canonical ID `frame_000123`.
VCMR validation rejects mismatches between frame ID and file name. Internal
object-store keys are never exposed in VCMR.

Timestamps describe the fixed-rate sampling timeline and are approximate rather
than original packet/frame PTS. That semantic is part of the schema contract.

## Canonical timeline

`timeline` is the common temporal coordinate system for every VCMR layer:

```json
{
  "origin": "video_start",
  "unit": "ms",
  "frameOrdering": "sample_index",
  "durationMs": 7142000,
  "samplingIntervalMs": 1000,
  "frameCount": 7142,
  "observedRange": { "startMs": 0, "endMs": 7141000 },
  "coverage": {
    "expectedFrameCount": 7142,
    "observedFrameCount": 7142,
    "complete": true
  }
}
```

The timeline deliberately distinguishes **media duration** from **observed
evidence range**. The final sampled frame normally occurs before the exact video
end, so `observedRange.endMs` must not be treated as media duration.

Every sampled frame has a zero-based `sampleIndex` derived from its stable
filename. For example, `000123.jpg` is `frame_000123` with
`sampleIndex = 122`. For fixed-rate sampling, consumers can seek by time using
the global `samplingIntervalMs` without storing redundant previous/next links
on every frame.

`coverage.complete` describes whether the currently available canonical frame
evidence count equals the expected fixed-rate sample count. It may be false for
processing Studies, expired evidence, or an incomplete extraction. It does not
claim that semantic detectors such as round or kill detection are complete.

### Temporal semantic layers

- `rounds[]`: `startMs`, optional `endMs`, optional `freezeEndMs`, and
  optional `startFrameId` / `endFrameId`.
- `events[]`: stable sequence metadata, `timestampMs`, optional
  `endTimestampMs`, optional round association, confidence, and evidence frames.
- `annotations[]`: optional start/end time plus evidence frame references.

The current fixed-rate extractor does **not** invent these gameplay semantics.
They remain empty until a detector can produce them with defensible evidence.

## Extension rule

New detectors should write into VCMR concepts, not invent detector-specific API
shapes. For example, an OCR kill-feed detector should eventually emit typed
`events[]` entries referencing `evidenceFrameIds`. Model-specific payloads
belong in adapters derived from VCMR, never in the canonical schema itself.
