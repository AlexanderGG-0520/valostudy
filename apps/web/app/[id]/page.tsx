import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "../../lib/auth";
import { buildManifest } from "../../lib/studies";
import { HttpError } from "../../lib/http";
import { StudyProcessingRefresh } from "../../components/study-processing-refresh";
import { ProcessingTiming } from "../../components/processing-timing";
import { FrameGallery } from "../../components/frame-gallery";

export const dynamic = "force-dynamic";

const phaseLabels: Record<string, string> = {
  queued: "Worker待機中",
  download: "録画をWorkerへ取得中",
  extract: "フレーム抽出中",
  persist: "フレームをR2へ保存中",
  finalize: "結果を確定中",
  completed: "完了",
  failed: "失敗",
};

const phases = [
  ["download", "動画取得"],
  ["extract", "フレーム抽出"],
  ["persist", "R2保存"],
  ["finalize", "確定"],
] as const;

function phaseState(current: string | undefined, phase: string) {
  if (current === "completed") return "done";
  const currentIndex = phases.findIndex(([key]) => key === current);
  const phaseIndex = phases.findIndex(([key]) => key === phase);
  if (current === phase) return "active";
  if (currentIndex > phaseIndex) return "done";
  return "upcoming";
}

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth().api.getSession({ headers: await headers() });
  const m = await buildManifest(id, session?.user.id).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const initialFrames = m.frames.slice(0, 120);
  const processing = m.status === "pending" || m.status === "queued" || m.status === "processing";
  const missingCompletedFrames = m.status === "completed" && !m.framesExpiredAt && m.frames.length === 0;
  const progress = m.processingProgress;
  const progressPercent = progress?.percent ?? 0;
  const frameProgress = progress?.totalFrames
    ? `${(progress.processedFrames ?? 0).toLocaleString()} / ${progress.totalFrames.toLocaleString()} frames`
    : null;

  return <main className="study-page">
    {processing && <StudyProcessingRefresh intervalMs={2000} />}

    <div className="study-topbar">
      <a className="back-link" href="/">← ValoStudy</a>
      <span className="status-badge">{m.status}</span>
    </div>

    <header className="study-header">
      <p className="eyebrow">STUDY / {m.studyId}</p>
      <h1>Study {m.studyId}</h1>
      <p>
        {processing
          ? "録画を解析してコーチング用フレームを生成しています。進捗は自動更新されます。"
          : "AI向けの完全なフレーム一覧は manifest.json にあります。このページでも全フレームを段階的に読み込んで確認できます。"}
      </p>
    </header>

    {processing && <section className="study-card processing-card">
      <div className="processing-title-row">
        <div>
          <p className="eyebrow">PROCESSING</p>
          <h2>{phaseLabels[progress?.stage ?? "queued"] ?? "処理中"}</h2>
        </div>
        <strong className="processing-percent">{progressPercent}%</strong>
      </div>

      <div
        className="processing-progress-track"
        role="progressbar"
        aria-label="Study processing progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="processing-phases" aria-label="処理ステージ">
        {phases.map(([key, label]) => <div className={`processing-phase ${phaseState(progress?.stage, key)}`} key={key}>
          <span />
          <strong>{label}</strong>
        </div>)}
      </div>

      <div className="processing-metrics">
        <ProcessingTiming startedAt={progress?.startedAt ?? null} percent={progressPercent} />
        <div>
          <span>フレーム</span>
          <strong>{frameProgress ?? (progress?.stage === "download" ? "動画取得中" : "算出中")}</strong>
        </div>
        <div>
          <span>更新</span>
          <strong>約2秒ごと</strong>
        </div>
      </div>

      <p className="processing-note">
        残り時間は現在までの実測速度から出した概算です。ChatGPTなど外部AIに渡すのは completed になってからが確実です。
      </p>
    </section>}

    {m.status === "failed" && <section className="study-card">
      <h2>フレーム生成に失敗しました</h2>
      <p>
        Worker処理が完了できなかったため、このStudyにはAIが参照できるフレームがありません。
        新しいStudyとして再アップロードするか、Workerログを確認してください。
      </p>
    </section>}

    {m.status === "completed" && <a className="study-link" href={"/" + id + "/manifest.json"}>manifest.json を開く <span>→</span></a>}

    {m.framesExpiredAt && <section className="study-card retention-expired">
      <h2>フレーム保持期間が終了しました</h2>
      <p>
        保存期限に達したため画像フレームは削除されています。Study metadataとコーチングプロンプトは残っています。
      </p>
    </section>}

    {missingCompletedFrames && <section className="study-card">
      <h2>フレーム整合性エラー</h2>
      <p>
        Studyは completed ですが保存済みフレームが0件です。これは正常な完了状態ではありません。
        ChatGPTなど外部AIにはまだ渡さず、Workerとストレージの状態を確認してください。
      </p>
    </section>}

    <section className="study-card">
      <h2>プレイヤー設定</h2>
      <pre>{JSON.stringify(m.player, null, 2)}</pre>
    </section>

    <section className="study-card">
      <h2>コーチングプロンプト</h2>
      <pre>{m.prompt}</pre>
    </section>

    {m.status === "completed" && !m.framesExpiredAt && m.frames.length > 0 && <>
      <div className="frame-heading">
        <div>
          <p className="eyebrow">FRAME EVIDENCE</p>
          <h2>フレーム</h2>
        </div>
        <p>{m.frames.length.toLocaleString()} frames · {m.timestampNote}</p>
      </div>

      <FrameGallery studyId={id} initialFrames={initialFrames} totalFrames={m.frames.length} />
    </>}
  </main>;
}
