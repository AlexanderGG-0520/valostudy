import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "../../lib/auth";
import { buildManifest } from "../../lib/studies";
import { HttpError } from "../../lib/http";
import { StudyProcessingRefresh } from "../../components/study-processing-refresh";

export const dynamic = "force-dynamic";

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth().api.getSession({ headers: await headers() });
  const m = await buildManifest(id, session?.user.id).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const previewFrames = m.frames.slice(0, 120);
  const processing = m.status === "pending" || m.status === "queued" || m.status === "processing";
  const missingCompletedFrames = m.status === "completed" && !m.framesExpiredAt && m.frames.length === 0;

  return <main className="study-page">
    {processing && <StudyProcessingRefresh />}

    <div className="study-topbar">
      <a className="back-link" href="/">← ValoStudy</a>
      <span className="status-badge">{m.status}</span>
    </div>

    <header className="study-header">
      <p className="eyebrow">STUDY / {m.studyId}</p>
      <h1>Study {m.studyId}</h1>
      <p>
        {processing
          ? "録画のアップロードは受理されました。Workerが試合全体からフレームを生成しています。"
          : "AI向けの完全なフレーム一覧は manifest.json にあります。このページでは確認用に最大120枚だけプレビューします。"}
      </p>
    </header>

    {processing && <section className="study-card">
      <h2>フレーム生成中</h2>
      <p>
        現在の状態は {m.status} です。0/0 はフレーム欠落を意味しないため、処理完了まではフレーム件数を表示しません。
        このページは約5秒ごとに自動更新されます。
      </p>
      <p>
        ChatGPTなど外部AIにこのStudy URLを渡すのは、ステータスが completed になってからにしてください。
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
        保存期限に達したためWebPフレームは削除されています。Study metadataとコーチングプロンプトは残っています。
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
          <h2>フレームプレビュー</h2>
        </div>
        <p>{previewFrames.length} / {m.frames.length} frames · {m.timestampNote}</p>
      </div>

      <div className="frame-grid">
        {previewFrames.map((frame) => <figure className="frame-card" key={frame.url}>
          <a href={frame.url}>
            <picture>
              <img src={frame.url} alt={"Frame at " + frame.timestampMs + " ms"} loading="lazy" />
            </picture>
          </a>
          <figcaption>{(frame.timestampMs / 1000).toFixed(1)} s</figcaption>
        </figure>)}
      </div>
    </>}
  </main>;
}
