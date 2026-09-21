# Validation record

## PR #1 baseline

Validated locally for the initial TypeScript SaaS foundation:

- `pnpm install --frozen-lockfile`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed (shared packages, Worker and generated Next route types).
- `pnpm test`: 38 tests passed across 7 files; no skipped tests.
- `pnpm build`: passed (Next standalone and Worker bundle).
- `pnpm db:generate`: no schema drift.
- `pnpm audit`: no known vulnerabilities at validation time.
- Production standalone HTTP smoke check: home page, generated CSS and health endpoint returned successfully.
- `git diff --check`: passed; reviewed source, migrations, configuration and deleted prototype files.

Tests include real FFmpeg/FFprobe video processing; PGlite executing the PostgreSQL migration SQL; Better Auth registration/session/sign-out; Study ID constraints and collision bounds; private/public access; prompt snapshot stability; direct multipart completion and crash recovery with mocked storage; signed part Content-Length; Worker retries, failure states, WebP persistence and completed-job deduplication.

External-system limits:

- Docker daemon is unavailable and the Docker Compose CLI plugin is absent in this environment. Container builds, Compose startup and Kubernetes deployment were not executed.
- The configured MinIO image tag was resolved successfully from Quay. The initially checked Docker Hub mirror rejected access, so Compose uses Quay.
- Real PostgreSQL, Valkey/BullMQ, MinIO/R2 and browser-to-storage end-to-end operation were not exercised together. Storage calls are mocked in DB/Worker tests; actual signing is tested without network calls.
- PGlite checks PostgreSQL SQL behavior, but does not replace multi-connection concurrency and production infrastructure tests.

## Real-service E2E follow-up

The separate `pnpm test:e2e` runner now provisions isolated PostgreSQL 17, Valkey 8 and MinIO containers, migrates real PostgreSQL twice, starts the production Web and independent Worker, generates a real AVI with FFmpeg and executes Chromium tests without dependency mocks.

Coverage:

- Public and private Studies: browser uploads two parts directly to MinIO; Web receives JSON only; Worker extracts four timestamped WebP frames; manifest and frame routes enforce access.
- PostgreSQL job/Study state and real BullMQ completion agree; stored video size matches the fixture.
- Invalid media exhausts exactly three attempts and reaches failed, exposing no frames.
- Incomplete multipart and incorrectly signed part sizes are rejected; four concurrent completion notifications result in one persisted job and one successful processing attempt.

Local verification so far: lint, typecheck, 38 baseline tests and production builds pass. Chromium installed. Docker Compose 5.5.1 is installed, but Docker daemon is inactive and starting it requires interactive administrator authentication. The first local E2E attempt failed during service startup; no E2E success is claimed yet. Local and CI results will be recorded after execution.

The application architecture is unchanged: the new orchestration is confined to the test harness. Web and Worker remain separate processes, using real service containers through their normal production interfaces.
