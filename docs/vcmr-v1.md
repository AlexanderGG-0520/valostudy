# VCMR v1 — ValoStudy Canonical Match Representation

VCMR is ValoStudy's model-independent representation of a VALORANT Study.

The canonical contract is defined in `@valostudy/schema` by `vcmrMatchSchema`.
It is intentionally independent from ChatGPT, Claude, Gemini, local VLMs, or any
specific model vendor.

## Contract identity

- Schema: `valostudy.vcmr`
- Version: `1.0.0`
- Media type: `application/vnd.valostudy.vcmr+json; version=1.0.0`

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
- sampled frame evidence with stable IDs, timestamps, URLs, and provenance
- processing progress and frame-retention state
- immutable coaching prompt snapshot and protocol version

The schema also reserves `rounds`, `events`, and `annotations` as typed,
versioned semantic layers. They are empty in the current extractor rather than
being guessed from video. Future OCR/CV/VLM/replay detectors can populate them
without replacing the representation.

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

## Extension rule

New detectors should write into VCMR concepts, not invent detector-specific API
shapes. For example, an OCR kill-feed detector should eventually emit typed
`events[]` entries referencing `evidenceFrameIds`. Model-specific payloads
belong in adapters derived from VCMR, never in the canonical schema itself.
