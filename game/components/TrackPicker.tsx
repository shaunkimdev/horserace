"use client";

import { useEffect, useRef } from "react";
import StudioIcon from "./StudioIcon";
import {
  getTrack,
  trackPoint,
  TRACKS,
  trackAffinity,
  type ShapeStats,
  type TrackId,
} from "../lib/game";

export function traceTrack(
  ctx: CanvasRenderingContext2D,
  id: TrackId,
  offset = 0,
  start = 0,
  end = 1,
) {
  ctx.beginPath();
  const steps = Math.max(2, Math.ceil((end - start) * 300));
  for (let i = 0; i <= steps; i++) {
    const p = trackPoint(id, start + ((end - start) * i) / steps, offset);
    if (i) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
  }
}

export function paintTrackRoad(
  ctx: CanvasRenderingContext2D,
  id: TrackId,
  detailed = true,
) {
  const track = getTrack(id);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  traceTrack(ctx, id);
  ctx.strokeStyle = "#708cb522";
  ctx.lineWidth = 124;
  ctx.stroke();
  traceTrack(ctx, id);
  ctx.strokeStyle = "#c1cfe6";
  ctx.lineWidth = 112;
  ctx.stroke();
  traceTrack(ctx, id);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 106;
  ctx.stroke();
  if (detailed) {
    for (const offset of [-26, 0, 26]) {
      traceTrack(ctx, id, offset);
      ctx.setLineDash([9, 12]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#c9d5e9";
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const offset of [-55, 55]) {
      traceTrack(ctx, id, offset);
      ctx.setLineDash([12, 14]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = track.color;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else {
    traceTrack(ctx, id);
    ctx.setLineDash([12, 18]);
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const gate = (progress: number) => {
    const p = trackPoint(id, progress);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    for (let row = 0; row < 10; row++)
      for (let column = 0; column < 2; column++) {
        ctx.fillStyle = (row + column) % 2 ? "#fafbf3" : "#2b3427";
        ctx.fillRect(column * 7 - 7, row * 10.5 - 52.5, 7, 10.5);
      }
    ctx.restore();
  };
  gate(0);
  if (!track.closed) gate(1);
  ctx.restore();
}

export function TrackMap({ trackId }: { trackId: TrackId }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 240, 124);
    ctx.save();
    ctx.scale(0.2, 0.2);
    paintTrackRoad(ctx, trackId, false);
    ctx.restore();
  }, [trackId]);
  return (
    <canvas
      className="track-mini-map"
      ref={canvas}
      width={240}
      height={124}
      role="img"
      aria-label={`${getTrack(trackId).name} 코스 모양`}
    />
  );
}

type Props = {
  selected: TrackId;
  onSelect: (id: TrackId) => void;
  stats: ShapeStats;
  disabled?: boolean;
  lobby?: boolean;
};
export default function TrackPicker({
  selected,
  onSelect,
  stats,
  disabled = false,
  lobby = false,
}: Props) {
  return (
    <section className="track-picker" aria-label="트랙 선택">
      <div className="track-picker-heading">
        <div>
          <span className="eyebrow">
            {lobby ? "이번 경주의 코스" : "러너에게 어울리는 길"}
          </span>
          <h2>
            {!lobby && <span className="step-number">03</span>} 트랙 고르기
          </h2>
        </div>
        <p>
          {lobby
            ? "방장이 트랙을 바꾸면 모두 다시 준비해요."
            : "어떤 코스가 우리 선수와 잘 맞을까요?"}
          <br />
          <span>유리한 체형을 살펴보고 골라보세요.</span>
        </p>
      </div>
      <div
        className="track-options"
        role="group"
        aria-label="네 가지 경주 트랙"
      >
        {TRACKS.map((track, i) => {
          const affinity = trackAffinity(stats, track.id);
          return (
            <button
              key={track.id}
              className={`track-card ${selected === track.id ? "is-selected" : ""}`}
              aria-pressed={selected === track.id}
              disabled={disabled}
              onClick={() => onSelect(track.id)}
              style={{ "--track-accent": track.color } as React.CSSProperties}
            >
              <div className="track-card-top">
                <span>코스 0{i + 1}</span>
                <i>
                  <StudioIcon
                    name={selected === track.id ? "check" : "arrow"}
                  />
                </i>
              </div>
              <TrackMap trackId={track.id} />
              <span className="track-subtitle">{track.subtitle}</span>
              <strong>{track.name}</strong>
              <span className="track-description">{track.description}</span>
              <span className="track-strength">
                <b>유리</b> {track.advantage}
              </span>
              <span className="track-caution">{track.caution}</span>
              <span className="track-estimate">
                내 선수 예상{" "}
                <b>
                  {stats.valid
                    ? `${affinity.seconds.toFixed(1)}초`
                    : "그리면 분석해요"}
                </b>
              </span>
            </button>
          );
        })}
      </div>
      <div className="track-selection-note">
        <span className="tiny-dot" />
        <span>
          모든 레인은 1,000m · 예상 기록은 기준 장애물과 현재 그림으로 계산해요.
          실제 배치에 따라 달라질 수 있어요.
        </span>
        {lobby && disabled && <b>방장이 선택해요</b>}
      </div>
    </section>
  );
}
