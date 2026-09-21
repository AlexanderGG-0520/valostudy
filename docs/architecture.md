# Architecture

## Boundaries

Browser → FastAPI → disk / SQLite / FFmpeg.

Codex → capability URL → HTML / JSON manifest / selected JPEGs.

Codex → Reddit research → image inspection → coaching in the Codex conversation.

Valostudy does not execute Codex, store Codex credentials, use OpenAI API keys, or perform Reddit research. It publishes explicit coaching instructions, not an agent execution environment.

## Lifecycle

- Upload: stream raw request bytes to a UUID-named temporary file; enforce size/free-space/time limits; probe video; move to session storage.
- Configure: validate the full player profile and extraction bounds before enqueuing.
- Extract: SQLite `queued` → `extracting` → `ready` or `failed`. One asynchronous worker invokes FFmpeg via an argument array, never a shell string.
- Share: select existing frame names and generate an unguessable key. Store only its SHA-256 hash and an immutable snapshot of the selected frames, profile, context, extraction settings and fully rendered coaching prompt.
- Review page: server-rendered HTML with the complete prompt. No JavaScript required. The manifest repeats the same prompt and exposes ordered, scoped image URLs.
- Re-extract/delete: invalidate all older shares before permitting access to changed assets.

The prompt generation is a deterministic template substitution. The app cannot prove that a separate Codex session obeys it. The output format asks Codex to provide research sources, dates and image evidence so the user can review compliance.

## Storage

```
data/
  sessions.sqlite3
  worker.lock
  <session UUID>/
    source
    frames/frame_0001.jpg
```

SQLite is kept on local storage; use a local-backed volume for the first Docker version. Back up both the database and media together while the app is stopped. The session worker is single-process; multiple Uvicorn workers are rejected with a filesystem lock. Replacing this with a separate durable worker is a later scaling step.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/login` | APP_TOKEN in JSON body |
| POST | `/api/logout` | Owner cookie |
| GET | `/api/config`, `/api/sessions` | Owner cookie |
| POST | `/api/uploads?name=recording.mp4` | Owner cookie; raw video bytes |
| GET / DELETE | `/api/sessions/{id}` | Owner cookie |
| POST | `/api/sessions/{id}/extract` | Owner cookie; profile + bounds + context |
| GET | `/api/sessions/{id}/video` | Owner cookie |
| GET | `/api/sessions/{id}/frames/{name}` | Owner cookie |
| POST / GET | `/api/sessions/{id}/shares` | Owner cookie |
| DELETE | `/api/shares/{id}` | Owner cookie |
| GET | `/review/{id}?key=...` | Scoped, expiring key |
| GET | `/review/{id}/manifest?key=...` | Same key |
| GET | `/review/{id}/frames/{name}?key=...` | Same key + selected frame allowlist |

`GET /api/health` only exposes liveness. Keys are not returned in the share-list API. Images and session metadata are `no-store`. Public assets contain no external CDN dependencies. HTML escapes user-provided context; the frontend inserts user data as text.

## Deliberate MVP limits

Single owner; no user accounts or billing. No audio transcription, automatic highlight detection, automatic Reddit scraper, model API, resumeable uploads, automatic media retention, or feedback-result storage. Existing sample Sites page is not the runtime. Linux filesystem locking and process-group termination are used. Use a dedicated service user and regular FFmpeg security updates; this application does not provide a hostile multi-tenant media sandbox.
