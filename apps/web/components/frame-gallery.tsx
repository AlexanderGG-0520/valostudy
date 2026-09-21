"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Frame = {
  timestampMs: number;
  url: string;
};

const PAGE_SIZE = 120;

export function FrameGallery({
  studyId,
  initialFrames,
  totalFrames,
}: {
  studyId: string;
  initialFrames: Frame[];
  totalFrames: number;
}) {
  const [frames, setFrames] = useState(initialFrames);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || frames.length >= totalFrames) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/" + studyId + "/frames.json?offset=" + frames.length + "&limit=" + PAGE_SIZE,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Failed to load frames");
      const data = await response.json() as { frames: Frame[]; total: number };
      setFrames((current) => [...current, ...data.frames]);
    } catch {
      setError("追加フレームの読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [frames.length, loading, studyId, totalFrames]);

  useEffect(() => {
    if (frames.length >= totalFrames) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "900px 0px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [frames.length, loadMore, totalFrames]);

  const remaining = Math.max(0, totalFrames - frames.length);

  return <>
    <div className="frame-grid">
      {frames.map((frame) => <figure className="frame-card" key={frame.url}>
        <a href={frame.url}>
          <picture>
            <img src={frame.url} alt={"Frame at " + frame.timestampMs + " ms"} loading="lazy" />
          </picture>
        </a>
        <figcaption>{(frame.timestampMs / 1000).toFixed(1)} s</figcaption>
      </figure>)}
    </div>

    <div className="frame-gallery-footer" ref={sentinelRef}>
      <span>{frames.length.toLocaleString()} / {totalFrames.toLocaleString()} frames</span>
      {error && <span className="frame-gallery-error">{error}</span>}
      {remaining > 0
        ? <button
            type="button"
            className="secondary-button frame-load-more"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading
              ? "読み込み中…"
              : "次の" + Math.min(PAGE_SIZE, remaining).toLocaleString() + "枚を表示"}
          </button>
        : <strong>全フレームを表示しました</strong>}
    </div>
  </>;
}
