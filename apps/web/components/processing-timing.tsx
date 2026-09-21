"use client";

import { useEffect, useState } from "react";

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}時間${minutes % 60}分`;
  }
  return minutes ? `${minutes}分${seconds.toString().padStart(2, "0")}秒` : `${seconds}秒`;
}

export function ProcessingTiming({ startedAt, percent }: { startedAt: string | null; percent: number }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedMs = now !== null && startedAt
    ? Math.max(0, now - new Date(startedAt).getTime())
    : null;
  const etaMs = elapsedMs !== null && percent >= 10 && percent < 99
    ? Math.round((elapsedMs / percent) * (100 - percent))
    : null;

  return <>
    <div>
      <span>経過時間</span>
      <strong>{elapsedMs === null ? "開始待ち" : formatDuration(elapsedMs)}</strong>
    </div>
    <div>
      <span>残り目安</span>
      <strong>{etaMs === null ? "計算中" : `約 ${formatDuration(etaMs)}`}</strong>
    </div>
  </>;
}
