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
  return <main><a href="/">← ValoStudy</a><h1>Study {m.studyId}</h1>
    <p>処理状態: {m.status}（処理中はページを再読み込みしてください）</p>
    <a href={`/${id}/manifest.json`}>manifest.json</a>
    <h2>プレイヤー設定</h2><pre>{JSON.stringify(m.player, null, 2)}</pre>
    <h2>コーチングプロンプト</h2><pre>{m.prompt}</pre>
    <p>{m.timestampNote}</p><div className="grid gap-4 sm:grid-cols-2">
      {m.frames.map((f) => <figure key={f.url}><a href={f.url}><picture><img src={f.url} alt={`Frame at ${f.timestampMs} ms`} loading="lazy" /></picture></a><figcaption>{f.timestampMs} ms</figcaption></figure>)}
    </div></main>;
}
