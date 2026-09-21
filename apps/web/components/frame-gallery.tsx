"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Frame = {
  timestampMs: number;
  url: string;
};

const PAGE_SIZE = 120;

export function FrameGallery({ frames }: { frames: Frame[] }) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(PAGE_SIZE, frames.length));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(Math.min(PAGE_SIZE, frames.length));
  }, [frames.length]);

  useEffect(() => {
    if (visibleCount >= frames.length) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisibleCount((count) => Math.min(count + PAGE_SIZE, frames.length));
    }, { rootMargin: "800px 0px" });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [frames.length, visibleCount]);

  const visibleFrames = useMemo(() => frames.slice(0, visibleCount), [frames, visibleCount]);
  const remaining = Math.max(0, frames.length - visibleCount);

  return <>
    <div className="frame-grid">
      {visibleFrames.map((frame) => <figure className="frame-card" key={frame.url}>
        <a href={frame.url}>
          <picture>
            <img src={frame.url} alt={"Frame at " + frame.timestampMs + " ms"} loading="lazy" />
          </picture>
        </a>
        <figcaption>{(frame.timestampMs / 1000).toFixed(1)} s</figcaption>
      </figure>)}
    </div>

    <div className="frame-gallery-footer" ref={sentinelRef}>
      <span>{visibleCount.toLocaleString()} / {frames.length.toLocaleString()} frames</span>
      {remaining > 0
        ? <button type="button" className="secondary-button frame-load-more" onClick={() =>
            setVisibleCount((count) => Math.min(count + PAGE_SIZE, frames.length))
          }>
            次の{Math.min(PAGE_SIZE, remaining).toLocaleString()}枚を表示
          </button>
        : <strong>全フレームを表示しました</strong>}
    </div>
  </>;
}
