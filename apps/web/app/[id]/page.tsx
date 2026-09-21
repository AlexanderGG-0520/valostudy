import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "../../lib/auth";
import { buildManifest } from "../../lib/studies";
import { HttpError } from "../../lib/http";

export const dynamic = "force-dynamic";

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth().api.getSession({ headers: await headers() });
  const m = await buildManifest(id, session?.user.id).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const previewFrames = m.frames.slice(0, 120);

  return <main className="study-page">
    <div className="study-topbar">
      <a className="back-link" href="/">← ValoStudy</a>
      <span className="status-badge">{m.status}</span>
    </div>

    <header className="study-header">
      <p className="eyebrow">STUDY / {m.studyId}</p>
      <h1>Study {m.studyId}</h1>
      <p>
        AI向けの完全なフレーム一覧は manifest.json にあります。
        このページでは確認用に最大120枚だけプレビューします。
      </p>
    </header>

    <a className="study-link" href={`/${id}/manifest.json`}>manifest.json を開く <span>→</span></a>

    <section className="study-card">
      <h2>プレイヤー設定</h2>
      <pre>{JSON.stringify(m.player, null, 2)}</pre>
    </section>

    <section className="study-card">
      <h2>コーチングプロンプト</h2>
      <pre>{m.prompt}</pre>
    </section>

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
            <img src={frame.url} alt={`Frame at ${frame.timestampMs} ms`} loading="lazy" />
          </picture>
        </a>
        <figcaption>{(frame.timestampMs / 1000).toFixed(1)} s</figcaption>
      </figure>)}
    </div>
  </main>;
}
