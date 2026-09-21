"use client";

import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import type { Plan } from "@valostudy/schema";
import { Button } from "./ui/button";

const authClient = createAuthClient();

type StudyRow = {
  id: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed";
  visibility: "private" | "public";
  plan: Plan;
  player: { rank: string; context: string };
  createdAt: string;
  completedAt: string | null;
  framesExpiredAt: string | null;
};

type StudyResponse = {
  studies: StudyRow[];
  plan: Plan;
  compareLimit: number;
};

function shortDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function StudyLibrary() {
  const { data: session } = authClient.useSession();
  const sessionUserId = session?.user.id;
  const [data, setData] = useState<StudyResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!sessionUserId) return;
    void fetch("/api/studies", { cache: "no-store" }).then(async (response) => {
      if (active && response.ok) setData(await response.json() as StudyResponse);
    });
    return () => { active = false; };
  }, [sessionUserId]);

  if (!sessionUserId || !data) return null;

  function toggle(id: string) {
    const compareLimit = data?.compareLimit ?? 0;
    setSelected((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < compareLimit ? [...current, id] : current);
  }

  async function compare() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyIds: selected, visibility }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "Comparison creation failed");
      window.location.assign(body.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "比較を作成できませんでした");
      setBusy(false);
    }
  }

  return <section className="library-section">
    <div className="section-heading compact">
      <div>
        <p className="section-index">STUDY LIBRARY</p>
        <h2>過去の試合を、単発で終わらせない。</h2>
      </div>
      <p className="section-copy">
        最近のStudyを50件まで表示します。
        {data.compareLimit > 0
          ? ` ${data.plan === "plus" ? "Plus" : "Pro"}では最大${data.compareLimit}件を1つの比較manifestにまとめられます。`
          : " Study comparisonはPlusから利用できます。"}
      </p>
    </div>

    {data.compareLimit > 0 && <div className="compare-toolbar">
      <div>
        <strong>{selected.length} / {data.compareLimit} selected</strong>
        <span>completed Studyを2件以上選択</span>
      </div>
      <select
        aria-label="比較の公開範囲"
        value={visibility}
        onChange={(event) => setVisibility(event.currentTarget.value as "private" | "public")}
      >
        <option value="private">Private comparison</option>
        <option value="public">Public comparison</option>
      </select>
      <Button
        type="button"
        className="primary-button"
        disabled={busy || selected.length < 2}
        onClick={() => void compare()}
      >
        {busy ? "Creating…" : "比較Studyを作成"}
      </Button>
    </div>}

    <div className="study-library-list">
      {data.studies.length === 0 && <p className="empty-library">まだStudyがありません。</p>}
      {data.studies.map((study) => {
        const selectable = data.compareLimit > 0 && study.status === "completed";
        const checked = selected.includes(study.id);
        return <article className="library-row" key={study.id}>
          {data.compareLimit > 0 && <input
            type="checkbox"
            aria-label={`Study ${study.id} を比較対象にする`}
            checked={checked}
            disabled={!selectable || (!checked && selected.length >= data.compareLimit)}
            onChange={() => toggle(study.id)}
          />}
          <a href={`/${study.id}`}>
            <strong>Study {study.id}</strong>
            <span>{study.player.rank} · {study.visibility} · {study.status}</span>
          </a>
          <div className="library-meta">
            <span>{shortDate(study.createdAt)}</span>
            {study.framesExpiredAt && <span className="expired-chip">FRAMES EXPIRED</span>}
          </div>
        </article>;
      })}
    </div>

    {visibility === "public" && selected.length > 0 && <p className="field-hint">
      Public comparisonにはPublic Studyだけを含められます。
    </p>}
    {message && <p className="status-line billing-error" role="status">{message}</p>}
  </section>;
}
