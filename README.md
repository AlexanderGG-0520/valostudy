# ValoStudy

VALORANTの試合全体の録画とプレイヤー設定からコーチング用フレームを抽出し、AIがURLで取得できるStudyページ・VCMR（ValoStudy Canonical Match Representation）・互換JSON manifestを作るSaaS基盤です。元動画は処理中だけ一時保持し、フレーム保存完了後に削除します。AIの自動実行は行いません。

## Architecture

```text
Browser ── JSON / session ── Next.js control plane ── PostgreSQL
   │                              │                      │
   └── direct multipart PUT ── S3/R2/MinIO        durable job outbox
                                  ▲                      │
                                  │                 Worker dispatcher
                                  │                      ▼
                                  └── JPEG ── Worker ← BullMQ / Valkey
                                                │
                                           FFprobe / FFmpeg
AI → /{id} → /{id}/canonical.json (VCMR) → /{id}/frames/000001.jpg
                   └→ /{id}/manifest.json (legacy projection)
```

Next.jsは認証、Stripe課金、entitlement、Study作成、uploadの署名と完了通知、閲覧を担当します。動画本体はブラウザからstorageへ直接送信します。FFmpegは独立Workerのみで実行します。完了通知でDBにjobを記録し、Worker内dispatcherが10秒ごとにBullMQへ投入するため、投入前の障害から復旧できます。

## Monorepo

| Path | Responsibility |
|---|---|
| apps/web | Next.js App Router、TypeScript、Tailwind、shadcn/ui Button、Better Auth |
| apps/worker | BullMQ dispatcher / processor、FFprobe / FFmpeg |
| packages/schema | Zod: VCMR canonical schema、Study ID、設定、入力、状態、manifest互換projection、prompt、job |
| packages/db | PostgreSQL、Drizzle、SQL migrations、ID生成 |
| packages/storage | S3-compatible multipart・object・frame操作 |
| packages/prompts | versioned JSON template、snapshot rendering |
| packages/config | environment validation、structured logs、queue接続 |
| infra/docker, infra/kubernetes | Web / Workerの独立配置 |
| tests | unit、route、PGlite DB integration、実FFmpegテスト |

## Dependencies / setup

Node.js 22以上、pnpm 10.34.0、PostgreSQL 17、Valkey 8（またはBullMQ対応Redis）、S3-compatible storage、Worker用FFmpeg/FFprobe（MJPEG encoder対応）が必要です。

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

http://localhost:3000 で登録・ログインし、アップロード前にプレイヤー設定・試合全体の録画・フレーム抽出間隔・公開範囲を入力します。 新規登録ではResendから確認メールを送り、リンクを開くまでメール/パスワードログインは完了しません。登録後はマイページからWebAuthnパスキーを追加でき、以後はパスキーでもログインできます。開始秒や終了秒の指定はなく、録画全体を処理します。デフォルトはprivate（ownerのみ）。publicを選ぶとAIがログインなしで取得できます。公開Studyのframe・設定・状況メモは誰でも閲覧できます。

MinIO consoleは http://localhost:9001 。privateの `valostudy` bucketを作成し、ブラウザのPUTを許可するCORSを設定します。AWS CLIを使う例（初回のみcreate-bucket）:

```bash
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  aws --endpoint-url "$S3_ENDPOINT" s3api create-bucket --bucket "$S3_BUCKET"
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-cors \
  --bucket "$S3_BUCKET" --cors-configuration file://infra/docker/cors.json
```

MinIOのバージョンがbucket CORS APIをサポートしない場合は `MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:3000` を使用してください。R2ではブラウザからpresigned URLへ直接PUTするため、bucket CORSに本番origin `https://valostudy.alec-ofc.com` を正確に許可する必要があります（末尾スラッシュなし）。`infra/docker/cors.json` はlocalhostと本番originの両方を許可します。

R2へ反映・確認する例:

```bash
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
AWS_DEFAULT_REGION=auto \
aws --endpoint-url "$S3_ENDPOINT" s3api put-bucket-cors \
  --bucket "$S3_BUCKET" \
  --cors-configuration file://infra/docker/cors.json

AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
AWS_DEFAULT_REGION=auto \
aws --endpoint-url "$S3_ENDPOINT" s3api get-bucket-cors \
  --bucket "$S3_BUCKET"
```

未完了multipartを1日後にabortするbucket lifecycleも設定してください（DB保存前のクラッシュで残ったsession回収用）。

## Environment variables

| Variable | Purpose |
|---|---|
| DATABASE_URL | PostgreSQL接続URL |
| POSTGRES_PASSWORD | 開発ComposeのDB password |
| REDIS_URL | Valkey / Redis接続、rediss://でTLS |
| BETTER_AUTH_URL | Webの正規origin、認証・CSRF検証に使用 |
| BETTER_AUTH_SECRET | 32文字以上、全Web replicaで同じ秘密 |
| RESEND_API_KEY | Resend server API key。確認メール送信に使用 |
| RESEND_FROM_EMAIL | Resendで検証済みdomainの送信元。例: `VALOSTUDY <auth@example.com>` |
| S3_ENDPOINT | browserとWeb/Workerの双方から到達可能なendpoint |
| S3_REGION | MinIO: us-east-1 / R2: auto |
| S3_BUCKET | private bucket名 |
| S3_ACCESS_KEY / S3_SECRET_KEY | S3互換credential。R2ではManage R2 API tokensが表示するAccess Key ID / Secret Access Keyを使用（一般API token値は不可） |
| STRIPE_SECRET_KEY | Stripe server secret key |
| STRIPE_WEBHOOK_SECRET | `/api/billing/webhook` の署名検証secret |
| STRIPE_PLUS_PAYMENT_LINK_URL | Plus用Payment Link。既定値は `https://buy.stripe.com/5kQbJ0gR2fp9alR1ow9IQ04` |
| STRIPE_PRO_PAYMENT_LINK_URL | Pro用Payment Link。既定値は `https://buy.stripe.com/cNi6oG58k1yj3Xtd7e9IQ05` |
| STRIPE_PLUS_PRICE_ID / STRIPE_PRO_PRICE_ID | 旧Checkout Sessionやsubscription metadataからのplan判定用。Payment Link新規購入では必須ではない |

R2 endpointでは設定をfail-fast検証し、region=auto、32文字のAccess Key ID、64文字のSecret Access Key以外は外部リクエスト前に拒否します。

.envはGit対象外です。CLI/Workerは.envを自動ロードしません。上記のようにexportするか、container/Kubernetesから注入してください。秘密と署名URLをアクセスログへ記録しないでください。


## Plans / Stripe billing

| Plan | Study limit | Video / upload | Sampling | Frame retention | Paid features | Queue |
|---|---|---|---|---|---|---|
| Free | 1 Studyごとに6時間cooldown | 2h / 16GiB | 最大1 FPS / 7,200 frames | 30日 | 基本Study / Public・Private | Standard |
| Plus ($20/月) | 30 Studies / rolling 7 days | 2h / 32GiB | 最大2 FPS / 14,400 frames | 1年 | 最大20 Studyの横断比較 | Priority |
| Pro ($200/月) | UI上Unlimited（fair-use保護あり） | 4h / 64GiB | 最大5 FPS / 72,000 frames | 期限なし | 最大100 Study比較 + Coach Workspace（100 clients）+ Bearer API | Highest |

FreeのcooldownとPlus/Proのrolling quotaは、Study作成ボタンではなくmultipart uploadが正常完了してprocessingへ投入される時点で消費します。アップロード途中の失敗では消費しません。Workerが最終的に動画を処理できなかった場合はusage eventをreleaseするため、利用枠が戻ります。同一ユーザーのcompleteはPostgreSQL row lockで直列化し、並行requestによるquota超過を防ぎます。

`POST /api/billing/checkout` は新しいCheckout Sessionを自前生成せず、既存のStripe Payment Linkへ認証済みユーザーを送ります。serverは24時間有効のopaque checkout intentをDBへ作り、そのIDをPayment Linkの `client_reference_id` として渡し、emailもprefillします。Customer Portalは `POST /api/billing/portal`、状態表示は `GET /api/billing/status`。Webhookは `POST /api/billing/webhook` でraw bodyと `Stripe-Signature` をHMAC検証し、event IDをDBへ保存して冪等処理します。

新規購入は既存Payment Linkを使用します。Webhookの `checkout.session.completed` ではCheckout Sessionの `payment_link` をStripe APIから再取得し、checkout intentが要求したPlus/Proの設定済みURLと一致することをserver-sideで検証してからentitlementを紐付けます。これによりclient側でPlus/Proのリンクを差し替えて安いプランの支払いで上位権限を得ることを防ぎます。subscription eventがCheckout完了より先に到着しても、Checkout完了時にStripeからsubscription状態を再取得するためevent順序に依存しません。Customer Portalでsubscription cancellationとPlus/Pro間のplan changeを許可してください。既にpaid subscriptionがあるユーザーのplan変更は二重subscription防止のためPayment LinkではなくPortalへ送ります。

開発者アカウントにはserver-sideのbuilt-in Pro entitlementを適用できます。対象emailは正規化後のSHA-256で照合するため、plaintextの開発者emailはrepositoryへ保存しません。Developer entitlementはStripe Checkoutを要求せず、通常のPro制限・Coach Workspace・Bearer API権限をそのまま使用します。

### Paid analysis features

Plus / Proではログイン中のStudy Libraryからcompleted Studyを複数選択してcomparisonを作成できます。Plusは最大20件、Proは最大100件です。comparisonは `/compare/{id}` と `/compare/{id}/manifest.json` を持ち、AIへ複数試合を1つの長期 evidence setとして渡せます。public comparisonはpublic Studyだけから作成でき、private comparisonはowner sessionが必要です。

Proでは最大5個のBearer API keyを発行できます。secretは発行時に一度だけ表示し、DBにはSHA-256 hashと表示用prefixだけを保存します。revoked keyやPro subscriptionが失効したkeyは認証に使えません。

ProのCoach Workspaceでは最大100 clientを作成し、ownerが保持するcompleted Studyをplayer/client単位で割り当てられます。`/clients/{id}` と `/clients/{id}/manifest.json` がそのプレイヤーのlongitudinal coaching historyになり、元Studyを削除・複製せずに継続的な改善履歴としてAIへ渡せます。Client削除時は割当だけcascadeし、Study本体は残ります。

```bash
curl -H "Authorization: Bearer vsk_..." \
  https://valostudy.example.com/api/v1/studies

curl -H "Authorization: Bearer vsk_..." \
  https://valostudy.example.com/api/v1/studies/3fa91bc72de/canonical

curl -H "Authorization: Bearer vsk_..." \
  https://valostudy.example.com/api/v1/studies/3fa91bc72de/manifest

curl -H "Authorization: Bearer vsk_..." \
  https://valostudy.example.com/api/v1/clients

curl -H "Authorization: Bearer vsk_..." \
  https://valostudy.example.com/api/v1/clients/3fa91bc72de/manifest
```


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

公開／非公開のmanifestとJPEG取得、owner認可、不正動画のbounded retry、partサイズ検証、並行completeの冪等性を検証します。DB・queue・storage・HTTP・FFmpegはmockせず、Playwright側でPostgreSQLとBullMQの終端状態も確認します。R2固有の互換性やKubernetes配置は対象外です。

成功・失敗時ともテスト用process/container/tmpfsデータと動画fixtureを削除します。ログと失敗時スクリーンショットは `.e2e-artifacts/<run-id>/` に残します。署名URLやcookieを含むtrace/HARは記録しません。CIの独立 `e2e` jobも同じcommandを実行し、診断artifactを3日間保存します。強制終了・ホスト停止で残った場合は、ログのrun-idと `docker compose ls` で対象を確認し、その `valostudy-e2e-<run-id>` projectのみ削除してください。

## Study / manifest URL

Study IDは `crypto.randomBytes(6)` から作る11文字lowercase hex（44bit）、正規表現は `^[0-9a-f]{11}$`。DBのPRIMARY KEYとCHECKで保証し、衝突は最大8回まで再生成します。IDは認証tokenではありません。

- Study: `https://valostudy.example.com/3fa91bc72de`
- Canonical VCMR: `/3fa91bc72de/canonical.json`
- Manifest (legacy projection): `/3fa91bc72de/manifest.json`
- Frame: `/3fa91bc72de/frames/000001.jpg`

VCMR v1 (`valostudy.vcmr@1.0.0`) がStudyの正規表現です。現在のWorkerはmedia metadataとfixed-rate sampled frame evidenceをVCMRへ正規化し、PostgreSQL/object storageへ分割して永続化します。Web/APIはその正規化データからVCMR documentを決定的に組み立てます。既存manifestはVCMRから生成する互換projectionとして維持します。詳細は `docs/vcmr-v1.md` を参照してください。

VCMRとmanifestは内部object keyを含めません。frame routeがowner/public認可後にJPEGを配信します。既存StudyのWebPも後方互換で配信します。元動画をWeb経由で配信するrouteはありません。private取得にはowner cookieが必要です。

## Storage / queue / processing

1. `POST /api/studies` に小さなJSONを送信。Study、設定、prompt snapshot、4時間のmultipart sessionを作成。
2. `POST /api/uploads/{id}/parts` でpartNumberを指定。最大15分かつsession期限内の署名URLを取得。
3. Browserから16MiB単位で直接PUT。最後のpartのみ小さくなります。署名は想定Content-Lengthを含み、各part最大3回試行します。
4. `POST /api/uploads/{id}/complete` がListPartsの枚数・番号・サイズと完成objectのHEADサイズを検査。row lockで直列化し、再送は冪等。
5. 同一DB transactionで永続jobを作成。dispatcherがstable job IDでBullMQへ投入。最大3回の試行とexponential backoff。
6. Workerがstream download、FFprobe検証、録画全体のFFmpeg抽出、JPEG 4:4:4保存、動画/frame metadataとDB状態更新を実行。
7. フレームの永続化とDB更新が完了した直後に元動画objectを削除。処理が最終失敗した場合も元動画を削除。
8. Workerが期限切れ未完了sessionをabort・削除し、BullMQのstalled/failed状態をDBへ同期。

上限はplan snapshotで決まり、Freeは16GiB/2時間/1 FPS、Plusは32GiB/2時間/2 FPS、Proは64GiB/4時間/5 FPSです。録画全体を0.25/0.5/1/2/5 FPSでサンプリングし、最大frame数もplanごとに7,200/14,400/72,000枚へ制限します。Web UIの既定値は0.5 FPS（2秒ごと）。FFprobeは60秒、downloadは2時間、FFmpegは動画尺の最大2倍（最低30分・上限6時間）のtimeoutです。shellを使わず検証済みの引数配列を渡します。入力はローカルのMP4/MOV、MKV/WebM、AVIに制限し、ネットワークplaylistを受け付けません。timestampMsはサンプリング時刻の目安で、厳密な元フレームPTSではありません。

Studyはpending → queued → processing → completed / failed。DB jobのpendingは投入待ちです。dispatcher再起動後に未投入・stalled jobを回収します。Queue priorityはFree/Plus/Proで段階化しています。completed frameはFree 30日、Plus 1年でWorkerがobject storageとDBから削除し、Study metadataとprompt snapshotは残します。Pro frameには自動expiryを設定しません。

## Prompt snapshots / Reddit research

`packages/prompts/src/v1.json` はid、version、systemPrompt、researchPrompt、coachingPrompt、createdAtを保持します。DBに同versionがあれば上書きしません。Study作成時に保存済みtemplateをrenderしてsnapshotを保存し、後の閲覧や再試行では再生成しません。変更は新versionにしてください。

コーチング開始前に現在のVALORANT subredditのReddit本文・コメントを調べ、出典・投稿日・patch・metaを確認する指示を含みます。Redditはground truthではなく、古い議論の適用範囲を確認し、最終判断では動画・frame evidenceを優先します。アプリ自身のReddit取得やAIの遵守検証はありません。

## Docker / Kubernetes

```bash
docker build -f infra/docker/web.Dockerfile -t valostudy-web .
docker build -f infra/docker/worker.Dockerfile -t valostudy-worker .
```

WebはNext standalone、WorkerはFFmpeg入りNode image。Workerはworkspace TypeScript exportsをtsxで解決します。migrationを1回実行してからそれぞれ起動します。

`infra/kubernetes/apps.yaml` のimage、origin、storageを置換し、別途Secret `valostudy-secrets` にDATABASE_URL、REDIS_URL、BETTER_AUTH_SECRET、RESEND_API_KEY、RESEND_FROM_EMAIL、S3_ACCESS_KEY、S3_SECRET_KEYを設定します。秘密の実値はmanifestにありません。TLS Ingress・PostgreSQL・Valkey・storageは別途用意してください。Web/Workerは独立scale可能、Workerは1podあたりconcurrency=1で一時storageが必要です。

## Observability / current limitations

JSON logsにstudyId、jobId、stage、duration、frameCount、retryCount、error reasonを付与します。OpenTelemetry、Prometheus、Grafana、Lokiのexporter/dashboardは未実装です。

- Better Authのemail/password登録・ログインとowner認可を実装。email verification、password reset、OAuth、MFA、分散rate limitは未実装。
- Free/Plus/Pro quota、Stripe subscription、frame retentionは実装済み。WAFとbucket lifecycleの自動設定は未実装。
- Study LibraryとPlus/Pro comparisonは実装済み。公開範囲変更、削除UI、失効・期限付き共有、frame選択、再処理UIは未実装。
- ページ再読込後のupload再開、complete通知のUI再試行は未実装。中断multipartは4時間後に回収。
- 作成途中のクラッシュで残るpending Study、DB未記録multipartの完全回収は未実装。frame保持期限はWorkerが処理します。元動画は正常完了または最終失敗時にWorkerが削除し、bucket lifecycleは異常終了時の補完として必要です。
- FFmpeg専用sandbox/network policy、DB/queue readiness、アラート、queue retentionは追加対象。health endpointは生存確認のみ。
- Proのread-only Bearer API、長期Study比較、単一アカウント向けCoach Workspaceは実装済み。高度なCV、OCR、音声解析、自動コーチングAI、adaptive sampling、team invite / multi-seat RBAC、batch uploadは未実装。
- 旧FastAPI/SQLiteからのデータmigrationはありません。旧実装はGit commit `d8c6a13` に残っています。

## References / license

[Next.js installation](https://nextjs.org/docs/app/getting-started/installation) /
[Better Auth Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle) /
[BullMQ retries](https://docs.bullmq.io/guide/retrying-failing-jobs) /
[BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled)

既存のGPL-3.0 [LICENSE](LICENSE)を維持しています。
