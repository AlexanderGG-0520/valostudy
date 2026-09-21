import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "../../../lib/auth";
import { buildComparisonManifest } from "../../../lib/comparisons";
import { HttpError } from "../../../lib/http";

export const dynamic = "force-dynamic";

export default async function ComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth().api.getSession({ headers: await headers() });
  const comparison = await buildComparisonManifest(id, session?.user.id).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });

  return <main className="study-page">
    <div className="study-topbar">
      <a className="back-link" href="/">← ValoStudy</a>
      <span className="status-badge">COMPARE · {comparison.studies.length}</span>
    </div>
    <header className="study-header">
      <p className="eyebrow">LONGITUDINAL EVIDENCE / {comparison.comparisonId}</p>
      <h1>Study Comparison</h1>
      <p>{comparison.instruction}</p>
    </header>

    <a className="study-link" href={`/compare/${id}/manifest.json`}>
      comparison manifest.json を開く <span>→</span>
    </a>

    <section className="study-card">
      <h2>比較対象</h2>
      <div className="comparison-list">
        {comparison.studies.map((study, index) => <a href={`/${study.studyId}`} key={study.studyId}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>Study {study.studyId}</strong>
          <small>{study.player.rank} · {study.status}</small>
        </a>)}
      </div>
    </section>
  </main>;
}
