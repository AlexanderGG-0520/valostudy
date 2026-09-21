# ValoStudy

VALORANTの試合全体の録画とプレイヤー設定からコーチング用フレームを抽出し、AIがURLで取得できるStudyページ・JSON manifestを作るSaaS基盤です。元動画は処理中だけ一時保持し、フレーム保存完了後に削除します。AIの自動実行は行いません。

## Architecture

```text
Browser ── JSON / session ── Next.js control plane ── PostgreSQL
   │                              │                      │
   └── direct multipart PUT ── S3/R2/MinIO        durable job outbox
                                  ▲                      │
                                  │                 Worker dispatcher
                                  │                      ▼
                                  └── WebP ── Worker ← BullMQ / Valkey
                                                │
                                           FFprobe / FFmpeg
AI → /{id} → /{id}/manifest.json → /{id}/frames/000001.webp
```

Next.jsは認証、DB、Study作成、uploadの署名と完了通知、閲覧を担当します。動画本体はブラウザからstorageへ直接送信します。FFmpegは独立Workerのみで実行します。完了通知でDBにjobを記録し、Worker内dispatcherが10秒ごとにBullMQへ投入するため、投入前の障害から復旧できます。

## Monorepo

| Path | Responsibility |
|---|---|
| apps/web | Next.js App Router、TypeScript、Tailwind、shadcn/ui Button、Better Auth |
| apps/worker | BullMQ dispatcher / processor、FFprobe / FFmpeg |
| packages/schema | Zod: Study ID、設定、入力、状態、manifest、prompt、job |
| packages/db | PostgreSQL、Drizzle、SQL migrations、ID生成 |
| packages/storage | S3-compatible multipart・object・frame操作 |
| packages/prompts | versioned JSON template、snapshot rendering |
| packages/config | environment validation、structured logs、queue接続 |
| infra/docker, infra/kubernetes | Web / Workerの独立配置 |
| tests | unit、route、PGlite DB integration、実FFmpegテスト |

## Dependencies / setup

Node.js 22以上、pnpm 10.34.0、PostgreSQL 17、Valkey 8（またはBullMQ対応Redis）、S3-compatible storage、Worker用FFmpeg/FFprobe（libwebp対応）が必要です。

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# .envの空欄とREPLACE_LOCAL_PASSWORDを設定する。
# BETTER_AUTH_SECRETは32文字以上のランダム値。
set -a
source .env
set +a
docker compose -f infra/docker/compose.yaml up -d
pnpm db:migrate
pnpm dev
# 別ターミナルでも同じ環境変数をexport:
pnpm dev:worker
```

http://localhost:3000 で登録・ログインし、アップロード前にプレイヤー設定・試合全体の録画・フレーム抽出間隔・公開範囲を入力します。開始秒や終了秒の指定はなく、録画全体を処理します。デフォルトはprivate（ownerのみ）。publicを選ぶとAIがログインなしで取得できます。公開Studyのframe・設定・状況メモは誰でも閲覧できます。

MinIO consoleは http://localhost:9001 。privateの `valostudy` bucketを作成し、ブラウザのPUTを許可するCORSを設定します。AWS CLIを使う例（初回のみcreate-bucket）:

```bash
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  aws --endpoint-url "$S3_ENDPOINT" s3api create-bucket --bucket "$S3_BUCKET"
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-cors \
  --bucket "$S3_BUCKET" --cors-configuration file://infra/docker/cors.json
```

MinIOのバージョンがbucket CORS APIをサポートしない場合は `MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:3000` を使用してください。R2では実際のWeb originのみ許可します。未完了multipartを1日後にabortするbucket lifecycleも設定してください（DB保存前のクラッシュで残ったsession回収用）。

## Environment variables

| Variable | Purpose |
|---|---|
| DATABASE_URL | PostgreSQL接続URL |
| POSTGRES_PASSWORD | 開発ComposeのDB password |
| REDIS_URL | Valkey / Redis接続、rediss://でTLS |
| BETTER_AUTH_URL | Webの正規origin、認証・CSRF検証に使用 |
| BETTER_AUTH_SECRET | 32文字以上、全Web replicaで同じ秘密 |
| S3_ENDPOINT | browserとWeb/Workerの双方から到達可能なendpoint |
| S3_REGION | MinIO: us-east-1 / R2: auto |
| S3_BUCKET | private bucket名 |
| S3_ACCESS_KEY / S3_SECRET_KEY | bucket操作権限のcredential |

.envはGit対象外です。CLI/Workerは.envを自動ロードしません。上記のようにexportするか、container/Kubernetesから注入してください。秘密と署名URLをアクセスログへ記録しないでください。

## Commands / tests

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @valostudy/web start
pnpm --filter @valostudy/worker start
pnpm db:generate
pnpm db:migrate
```

テストはservice・credential不要、FFmpeg/FFprobeは必須です。PGliteで実SQL migrationとDB制約、認可、upload再実行を検証します。本番PostgreSQL / R2 / Valkeyを組み合わせたend-to-end検証は別途必要です。GitHub Actionsもinstall・lint・typecheck・test・buildを実行します。

### Real-service browser E2E

Docker Engine（起動済みで現在のユーザーが利用可能）、Docker Compose、FFmpeg/FFprobeが必要です。通常のunitテストとは分離しています。

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
# Ubuntu CI等でブラウザのOS依存関係も必要な場合:
# pnpm exec playwright install --with-deps chromium
pnpm build
pnpm test:e2e
```

runnerが専用Compose projectでPostgreSQL 17、Valkey 8、MinIOを起動し、ランダムなcredential・loopback port・bucketを作成します。既存.env・開発DB・開発bucketは使いません。実DBへmigrationを2回適用し、production standalone Webと独立Workerを起動します。FFmpegで16MiB超のAVIを生成し、Chromiumから別originのMinIOへ直接multipart PUTします。

公開／非公開のmanifestとWebP取得、owner認可、不正動画のbounded retry、partサイズ検証、並行completeの冪等性を検証します。DB・queue・storage・HTTP・FFmpegはmockせず、Playwright側でPostgreSQLとBullMQの終端状態も確認します。R2固有の互換性やKubernetes配置は対象外です。

成功・失敗時ともテスト用process/container/tmpfsデータと動画fixtureを削除します。ログと失敗時スクリーンショットは `.e2e-artifacts/<run-id>/` に残します。署名URLやcookieを含むtrace/HARは記録しません。CIの独立 `e2e` jobも同じcommandを実行し、診断artifactを3日間保存します。強制終了・ホスト停止で残った場合は、ログのrun-idと `docker compose ls` で対象を確認し、その `valostudy-e2e-<run-id>` projectのみ削除してください。

## Study / manifest URL

Study IDは `crypto.randomBytes(6)` から作る11文字lowercase hex（44bit）、正規表現は `^[0-9a-f]{11}$`。DBのPRIMARY KEYとCHECKで保証し、衝突は最大8回まで再生成します。IDは認証tokenではありません。

- Study: `https://valostudy.example.com/3fa91bc72de`
- Manifest: `/3fa91bc72de/manifest.json`
- Frame: `/3fa91bc72de/frames/000001.webp`

manifestはschemaVersion、studyId、player、frames、coachingProtocol、promptを含むZod schemaで管理します。内部object keyを含めません。frame routeがowner/public認可後にWebPだけを配信します。元動画をWeb経由で配信するrouteはありません。private取得にはowner cookieが必要です。

## Storage / queue / processing

1. `POST /api/studies` に小さなJSONを送信。Study、設定、prompt snapshot、4時間のmultipart sessionを作成。
2. `POST /api/uploads/{id}/parts` でpartNumberを指定。最大15分かつsession期限内の署名URLを取得。
3. Browserから16MiB単位で直接PUT。最後のpartのみ小さくなります。署名は想定Content-Lengthを含み、各part最大3回試行します。
4. `POST /api/uploads/{id}/complete` がListPartsの枚数・番号・サイズと完成objectのHEADサイズを検査。row lockで直列化し、再送は冪等。
5. 同一DB transactionで永続jobを作成。dispatcherがstable job IDでBullMQへ投入。最大3回の試行とexponential backoff。
6. Workerがstream download、FFprobe検証、録画全体のFFmpeg抽出、WebP保存、動画/frame metadataとDB状態更新を実行。
7. フレームの永続化とDB更新が完了した直後に元動画objectを削除。処理が最終失敗した場合も元動画を削除。
8. Workerが期限切れ未完了sessionをabort・削除し、BullMQのstalled/failed状態をDBへ同期。

最大16GiB・2時間・4K相当。録画全体を0.25/0.5/1/2 FPSでサンプリングし、1 Studyあたり最大3600枚です。Web UIの既定値は0.5 FPS（2秒ごと）。FFprobe 60秒、download 2時間、FFmpeg 30分のtimeoutです。shellを使わず検証済みの引数配列を渡します。入力はローカルのMP4/MOV、MKV/WebM、AVIに制限し、ネットワークplaylistを受け付けません。timestampMsはサンプリング時刻の目安で、厳密な元フレームPTSではありません。

Studyはpending → queued → processing → completed / failed。DB jobのpendingは投入待ちです。dispatcher再起動後に未投入・stalled jobを回収します。completed/failedのBullMQ jobは自動削除しません。保持ポリシーは運用で追加してください。

## Prompt snapshots / Reddit research

`packages/prompts/src/v1.json` はid、version、systemPrompt、researchPrompt、coachingPrompt、createdAtを保持します。DBに同versionがあれば上書きしません。Study作成時に保存済みtemplateをrenderしてsnapshotを保存し、後の閲覧や再試行では再生成しません。変更は新versionにしてください。

コーチング開始前に現在のVALORANT subredditのReddit本文・コメントを調べ、出典・投稿日・patch・metaを確認する指示を含みます。Redditはground truthではなく、古い議論の適用範囲を確認し、最終判断では動画・frame evidenceを優先します。アプリ自身のReddit取得やAIの遵守検証はありません。

## Docker / Kubernetes

```bash
docker build -f infra/docker/web.Dockerfile -t valostudy-web .
docker build -f infra/docker/worker.Dockerfile -t valostudy-worker .
```

WebはNext standalone、WorkerはFFmpeg入りNode image。Workerはworkspace TypeScript exportsをtsxで解決します。migrationを1回実行してからそれぞれ起動します。

`infra/kubernetes/apps.yaml` のimage、origin、storageを置換し、別途Secret `valostudy-secrets` にDATABASE_URL、REDIS_URL、BETTER_AUTH_SECRET、S3_ACCESS_KEY、S3_SECRET_KEYを設定します。秘密の実値はmanifestにありません。TLS Ingress・PostgreSQL・Valkey・storageは別途用意してください。Web/Workerは独立scale可能、Workerは1podあたりconcurrency=1で一時storageが必要です。

## Observability / current limitations

JSON logsにstudyId、jobId、stage、duration、frameCount、retryCount、error reasonを付与します。OpenTelemetry、Prometheus、Grafana、Lokiのexporter/dashboardは未実装です。

- Better Authのemail/password登録・ログインとowner認可を実装。email verification、password reset、OAuth、MFA、分散rate limitは未実装。
- account quota、使用量制限、WAF、storage lifecycleの自動設定は未実装。
- 公開範囲変更、削除UI、失効・期限付き共有、frame選択、再処理UI、Study一覧は未実装。
- ページ再読込後のupload再開、complete通知のUI再試行は未実装。中断multipartは4時間後に回収。
- 作成途中のクラッシュで残るpending Study、DB未記録multipartの完全回収、frameの保持期限は未実装。元動画は正常完了または最終失敗時にWorkerが削除し、bucket lifecycleは異常終了時の補完として必要です。
- FFmpeg専用sandbox/network policy、DB/queue readiness、アラート、queue retentionは追加対象。health endpointは生存確認のみ。
- 高度なCV、OCR、音声解析、自動コーチングAI、billingは未実装。
- 旧FastAPI/SQLiteからのデータmigrationはありません。旧実装はGit commit `d8c6a13` に残っています。

## References / license

[Next.js installation](https://nextjs.org/docs/app/getting-started/installation) /
[Better Auth Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle) /
[BullMQ retries](https://docs.bullmq.io/guide/retrying-failing-jobs) /
[BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled)

既存のGPL-3.0 [LICENSE](LICENSE)を維持しています。
