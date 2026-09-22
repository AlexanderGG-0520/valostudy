import { notFound } from "next/navigation";
import { buildManifest } from "../../../lib/studies";
import { HttpError } from "../../../lib/http";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ValoStudy AI Entry Point",
  description: "Public ValoStudy data prepared as a lightweight HTML entry point for AI assistants.",
  robots: { index: true, follow: true },
};

const FRAME_PAGE_SIZE = 240;

export default async function AiStudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await buildManifest(id).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });

  const framePages = Math.ceil(m.frames.length / FRAME_PAGE_SIZE);
  const processing = m.status === "pending" || m.status === "queued" || m.status === "processing";

  return <main>
    <header>
      <h1>ValoStudy AI Entry Point</h1>
      <p>
        This is the public, server-rendered AI entry point for Study <strong>{m.studyId}</strong>.
        Read the player settings and coaching prompt below before reviewing frame evidence.
      </p>
    </header>

    <section aria-labelledby="study-summary">
      <h2 id="study-summary">Study summary</h2>
      <dl>
        <dt>Study ID</dt><dd>{m.studyId}</dd>
        <dt>Status</dt><dd>{m.status}</dd>
        <dt>Frame count</dt><dd>{m.frames.length}</dd>
        <dt>Timestamp semantics</dt><dd>{m.timestampNote}</dd>
      </dl>
      {processing && <p>The Study is still processing. Retry after it reaches completed status.</p>}
      {m.framesExpiredAt && <p>Frame retention expired at {m.framesExpiredAt}.</p>}
    </section>

    <nav aria-label="Machine-readable Study resources">
      <h2>Machine-readable resources</h2>
      <ul>
        <li><a href={`/${id}/manifest.json`}>manifest.json</a> — compact player, prompt, and complete frame index</li>
        <li><a href={`/${id}/canonical.json`}>canonical.json</a> — VCMR canonical representation</li>
        {m.status === "completed" && !m.framesExpiredAt && m.frames.length > 0 &&
          <li><a href={`/${id}/frames.json?offset=0&limit=240`}>frames.json first page</a> — paginated frame API</li>}
      </ul>
    </nav>

    <section aria-labelledby="player-settings">
      <h2 id="player-settings">Player settings</h2>
      <pre>{JSON.stringify(m.player, null, 2)}</pre>
    </section>

    <section aria-labelledby="coaching-protocol">
      <h2 id="coaching-protocol">Coaching protocol</h2>
      <pre>{JSON.stringify(m.coachingProtocol, null, 2)}</pre>
    </section>

    <section aria-labelledby="coaching-prompt">
      <h2 id="coaching-prompt">Coaching prompt</h2>
      <pre>{m.prompt}</pre>
    </section>

    {m.status === "completed" && !m.framesExpiredAt && m.frames.length > 0 && <section aria-labelledby="frame-evidence">
      <h2 id="frame-evidence">Frame evidence index</h2>
      <p>
        Frames are split into HTML index pages of at most {FRAME_PAGE_SIZE} entries so crawlers and AI assistants
        can traverse the entire Study without loading thousands of links at once.
      </p>
      <ol>
        {Array.from({ length: framePages }, (_, page) => {
          const start = page * FRAME_PAGE_SIZE + 1;
          const end = Math.min((page + 1) * FRAME_PAGE_SIZE, m.frames.length);
          return <li key={page}>
            <a href={`/ai/${id}/frames/${page + 1}`}>Frames {start}–{end}</a>
          </li>;
        })}
      </ol>
    </section>}

    <footer>
      <p><a href={`/${id}`}>Human Study page</a></p>
    </footer>
  </main>;
}
