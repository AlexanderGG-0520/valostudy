"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createAuthClient } from "better-auth/react";
import type { Plan } from "@valostudy/schema";
import { Button } from "./ui/button";

const authClient = createAuthClient();

type ClientRow = {
  id: string;
  displayName: string;
  riotId: string | null;
  notes: string;
  createdAt: string;
  studyCount: number;
};

type StudyRow = {
  id: string;
  status: string;
  player: { rank: string };
  createdAt: string;
};

export function CoachWorkspace() {
  const { data: session } = authClient.useSession();
  const sessionUserId = session?.user.id;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [studies, setStudies] = useState<StudyRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [studyId, setStudyId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [clientResponse, studyResponse] = await Promise.all([
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/studies", { cache: "no-store" }),
    ]);
    if (clientResponse.ok) {
      const body = await clientResponse.json() as { clients: ClientRow[] };
      setClients(body.clients);
      if (!clientId && body.clients[0]) setClientId(body.clients[0].id);
    }
    if (studyResponse.ok) {
      const body = await studyResponse.json() as { studies: StudyRow[] };
      const completed = body.studies.filter((study) => study.status === "completed");
      setStudies(completed);
      if (!studyId && completed[0]) setStudyId(completed[0].id);
    }
  }

  useEffect(() => {
    if (!sessionUserId) return;
    let active = true;
    void fetch("/api/billing/status", { cache: "no-store" }).then(async (response) => {
      if (!active || !response.ok) return;
      const billing = await response.json() as { plan: Plan };
      if (!active) return;
      setPlan(billing.plan);
      if (billing.plan !== "pro") return;
      const [clientResponse, studyResponse] = await Promise.all([
        fetch("/api/clients", { cache: "no-store" }),
        fetch("/api/studies", { cache: "no-store" }),
      ]);
      if (!active) return;
      if (clientResponse.ok) {
        const body = await clientResponse.json() as { clients: ClientRow[] };
        setClients(body.clients);
        if (body.clients[0]) setClientId(body.clients[0].id);
      }
      if (studyResponse.ok) {
        const body = await studyResponse.json() as { studies: StudyRow[] };
        const completed = body.studies.filter((study) => study.status === "completed");
        setStudies(completed);
        if (completed[0]) setStudyId(completed[0].id);
      }
    });
    return () => { active = false; };
  }, [sessionUserId]);

  if (!sessionUserId || plan !== "pro") return null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: data.get("displayName"),
          riotId: data.get("riotId") || null,
          notes: data.get("notes") || "",
        }),
      });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Client creation failed");
      event.currentTarget.reset();
      setClientId(body.id);
      await reload();
      setMessage("Clientを作成しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clientを作成できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    if (!clientId || !studyId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/clients/${clientId}/studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyId }),
      });
      const body = response.status === 204 ? {} : await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Study assignment failed");
      await reload();
      setMessage("StudyをClientに割り当てました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Studyを割り当てできませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function removeClient(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/clients/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "Client deletion failed");
      }
      if (clientId === id) setClientId("");
      await reload();
      setMessage("Clientを削除しました。Study自体は削除されません。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clientを削除できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return <section className="workspace-section">
    <div className="section-heading compact">
      <div>
        <p className="section-index">PRO · COACH WORKSPACE</p>
        <h2>プレイヤー単位で、試合の変化を追う。</h2>
      </div>
      <p className="section-copy">
        最大100 client。既存Studyをプレイヤーへ割り当てると、長期コーチング用manifestとしてまとめて取得できます。
      </p>
    </div>

    <div className="workspace-grid">
      <form className="client-create-card" onSubmit={create}>
        <h3>New client</h3>
        <label>
          <span className="field-label">表示名</span>
          <input name="displayName" required maxLength={100} placeholder="Player / Client name" />
        </label>
        <label>
          <span className="field-label">Riot ID</span>
          <input name="riotId" maxLength={100} placeholder="Name#TAG" />
        </label>
        <label>
          <span className="field-label">コーチ用メモ</span>
          <textarea name="notes" maxLength={2000} rows={3} placeholder="目標、ロール、継続して見たい課題など" />
        </label>
        <Button className="primary-button" disabled={busy}>Clientを追加</Button>
      </form>

      <div className="client-assign-card">
        <h3>Assign Study</h3>
        <label>
          <span className="field-label">Client</span>
          <select value={clientId} onChange={(event) => setClientId(event.currentTarget.value)}>
            <option value="">選択してください</option>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.displayName}</option>)}
          </select>
        </label>
        <label>
          <span className="field-label">Completed Study</span>
          <select value={studyId} onChange={(event) => setStudyId(event.currentTarget.value)}>
            <option value="">選択してください</option>
            {studies.map((study) => <option value={study.id} key={study.id}>
              {study.id} · {study.player.rank}
            </option>)}
          </select>
        </label>
        <Button className="primary-button" type="button" disabled={busy || !clientId || !studyId}
          onClick={() => void assign()}>
          Clientへ割り当て
        </Button>
      </div>
    </div>

    <div className="client-list">
      {clients.length === 0 && <p className="empty-library">まだClientがありません。</p>}
      {clients.map((client) => <article key={client.id}>
        <a href={`/clients/${client.id}`}>
          <strong>{client.displayName}</strong>
          <span>{client.riotId ?? "Riot ID未設定"} · {client.studyCount} Studies</span>
        </a>
        <Button type="button" className="secondary-button" variant="outline" disabled={busy}
          onClick={() => void removeClient(client.id)}>Delete</Button>
      </article>)}
    </div>

    {message && <p className="status-line" role="status">{message}</p>}
  </section>;
}
