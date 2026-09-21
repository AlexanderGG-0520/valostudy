import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "../../../lib/auth";
import { buildClientManifest } from "../../../lib/workspace";
import { HttpError } from "../../../lib/http";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) notFound();

  const manifest = await buildClientManifest(id, session.user.id).catch((error: unknown) => {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  });

  return <main className="study-page">
    <div className="study-topbar">
      <a className="back-link" href="/">← Coach Workspace</a>
      <span className="status-badge">PRO CLIENT</span>
    </div>
    <header className="study-header">
      <p className="eyebrow">LONG-TERM PLAYER HISTORY</p>
      <h1>{manifest.client.displayName}</h1>
      <p>{manifest.client.riotId ?? "Riot ID未設定"} · {manifest.studies.length} Studies</p>
    </header>

    <a className="study-link" href={`/clients/${id}/manifest.json`}>
      client manifest.json を開く <span>→</span>
    </a>

    {manifest.client.notes && <section className="study-card">
      <h2>Client notes</h2>
      <p>{manifest.client.notes}</p>
    </section>}

    <section className="study-card">
      <h2>Longitudinal Study history</h2>
      <div className="comparison-list">
        {manifest.studies.map((study, index) => <a href={`/${study.studyId}`} key={study.studyId}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>Study {study.studyId}</strong>
          <small>{study.player.rank}</small>
        </a>)}
      </div>
    </section>
  </main>;
}
