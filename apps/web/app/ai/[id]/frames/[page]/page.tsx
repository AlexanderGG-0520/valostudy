import { notFound } from "next/navigation";
import { buildPublicAiFramePage } from "../../../../../lib/studies";
import { HttpError } from "../../../../../lib/http";

export const dynamic = "force-dynamic";

const FRAME_PAGE_SIZE = 240;

export default async function AiFrameIndexPage({
  params,
}: {
  params: Promise<{ id: string; page: string }>;
}) {
  const { id, page: rawPage } = await params;
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 1) notFound();

  const offset = (page - 1) * FRAME_PAGE_SIZE;
  const m = await buildPublicAiFramePage(id, offset, FRAME_PAGE_SIZE).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });

  const totalPages = Math.ceil(m.total / FRAME_PAGE_SIZE);
  if (page > totalPages || m.frames.length === 0) notFound();

  const batch = m.frames;

  return <main>
    <header>
      <h1>ValoStudy frame index</h1>
      <p>
        Study <strong>{m.studyId}</strong> · page {page} of {totalPages} · frames {offset + 1}–
        {offset + batch.length}
      </p>
    </header>

    <nav aria-label="Frame index navigation">
      <p><a href={`/ai/${id}`}>AI Study entry point</a></p>
      {page > 1 && <a href={`/ai/${id}/frames/${page - 1}`}>Previous page</a>}
      {page < totalPages && <> {" · "} <a href={`/ai/${id}/frames/${page + 1}`}>Next page</a></>}
    </nav>

    <section aria-labelledby="frames">
      <h2 id="frames">Frame evidence</h2>
      <ol start={offset + 1}>
        {batch.map((frame, index) => {
          const absoluteIndex = offset + index + 1;
          return <li key={frame.url}>
            <a href={frame.url}>Frame {String(absoluteIndex).padStart(6, "0")}</a>
            {" — "}
            <time dateTime={`PT${frame.timestampMs / 1000}S`}>{frame.timestampMs} ms</time>
          </li>;
        })}
      </ol>
    </section>

    <footer>
      <p>{m.timestampNote}</p>
    </footer>
  </main>;
}
