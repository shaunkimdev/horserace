"use client";

import { useEffect, useRef } from "react";
import { getTrack, sampleRace, type Race, type Stroke } from "../lib/game";
import { createRaceCamera, RACE_VIEW } from "../lib/race-camera";
import { paintCourse, paintFence, paintObstacle } from "./race-scenery";

type AnimalOptions = {
  color?: string;
  time?: number;
  moving?: boolean;
  stride?: number;
  speed?: number;
  airborne?: number;
  landing?: number;
  facing?: number;
  ducking?: boolean;
  tilt?: number;
  lineWidth?: number;
};

/** Keep the user's outline, with a gallop driven by distance and articulated lower legs. */
export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  x: number,
  y: number,
  width: number,
  height: number,
  options: AnimalOptions = {},
) {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      top = Math.min(top, point.y);
      bottom = Math.max(bottom, point.y);
    }
  }
  if (!Number.isFinite(left) || right <= left || bottom <= top) return;
  const scale = Math.min(width / (right - left), height / (bottom - top));
  const drawnWidth = (right - left) * scale;
  const drawnHeight = (bottom - top) * scale;
  const phase = options.stride ?? (options.time ?? 0) * 19;
  const effort = Math.max(0.4, Math.min(1.2, (options.speed ?? 72) / 72));
  const tuck = Math.min(1, (options.airborne ?? 0) / 20);
  const landing = options.landing ?? 0;
  ctx.save();
  ctx.translate(x + width / 2, y + height);
  ctx.rotate(options.tilt ?? 0);
  ctx.scale(options.facing ?? 1, 1);
  if (options.moving && !tuck)
    ctx.scale(1 + Math.cos(phase) * 0.045, 1 - Math.cos(phase) * 0.025);
  if (landing) ctx.scale(1 + landing * 0.12, 1 - landing * 0.2);
  if (options.ducking) ctx.scale(1.08, 0.78);
  ctx.lineWidth = options.lineWidth ?? 3.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.strokeStyle = options.color ?? stroke.color ?? "#28372d";
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      let px = (point.x - left) * scale - drawnWidth / 2;
      let py = (point.y - top) * scale - drawnHeight;
      const foot = Math.max(
        0,
        ((point.y - top) / (bottom - top) - 0.57) / 0.43,
      );
      const along = (point.x - left) / (right - left);
      if (tuck) {
        px += (0.5 - along) * drawnWidth * 0.28 * foot * tuck;
        py -= drawnHeight * 0.27 * foot * tuck;
      } else if (options.moving) {
        const legPhase =
          phase + (along < 0.5 ? 0 : Math.PI * 0.88) + along * 0.65;
        px +=
          Math.sin(legPhase) *
          Math.pow(foot, 1.2) *
          drawnWidth *
          0.095 *
          effort;
        py -=
          Math.max(0, Math.cos(legPhase)) *
          Math.pow(foot, 1.5) *
          drawnHeight *
          0.19 *
          effort;
      }
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  ctx.restore();
}

const WIDTH = RACE_VIEW.width;
const HEIGHT = RACE_VIEW.height;
const INK = "#29352d";
function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.1, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  endX: number,
  endY: number,
  color: string,
  width = 2,
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function collisionBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  color: string,
) {
  ctx.save();
  const phase = time * 11;
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + phase * 0.06;
    const radius = 15 + Math.sin(phase) * 3;
    line(
      ctx,
      x + Math.cos(angle) * radius,
      y + Math.sin(angle) * radius,
      x + Math.cos(angle) * (radius + 8),
      y + Math.sin(angle) * (radius + 8),
      color,
      2.5,
    );
  }
  ctx.restore();
}

export type RaceCanvasProps = {
  race: Race;
  elapsed: number;
  playerId: string;
  onFinish?: () => void;
};

export default function RaceCanvas({
  race,
  elapsed,
  playerId,
  onFinish,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completedRef = useRef<Race | null>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const frame = sampleRace(race, elapsed);
    const player =
      frame.racers.find((racer) => racer.id === playerId) ?? frame.racers[0];
    if (!player) return;
    const camera = createRaceCamera(race.trackId, player.x, race.distance);
    const t = Math.max(0, elapsed);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const running = elapsed > 0;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#e5eed3";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    if (!reducedMotion && running && player.status === "stumbling")
      ctx.translate(Math.sin(t * 42) * 2, Math.cos(t * 35) * 1.4);

    paintCourse(ctx, camera, race, t);

    race.participants.forEach((participant, lane) => {
      for (const obstacle of race.course) {
        if (obstacle.x + obstacle.width < camera.from || obstacle.x > camera.to)
          continue;
        paintObstacle(ctx, camera, obstacle, lane, t);
      }
      const racer = frame.racers.find((item) => item.id === participant.id);
      if (!racer) return;
      const { x, y } = camera.surface(racer.x, lane);
      if (
        racer.x < camera.from - 50 ||
        racer.x > camera.to + 50 ||
        x < -150 ||
        x > WIDTH + 150 ||
        y < -100 ||
        y > HEIGHT + 150
      )
        return;
      const ahead = camera.surface(racer.x + 1, lane);
      const facing = ahead.x < x ? -1 : 1;
      const cornerLean = Math.max(
        -0.18,
        Math.min(
          0.18,
          (Math.atan2(ahead.y - y, Math.abs(ahead.x - x)) + Math.atan(0.1)) *
            0.16,
        ),
      );
      const isPlayer = participant.id === playerId;
      const color = participant.color || INK;
      const jumping = racer.y > 5;
      ellipse(
        ctx,
        x,
        y + 4,
        Math.max(30, 64 - racer.y * 0.35),
        7 - Math.min(3, racer.y * 0.045),
        "#d7deca",
      );
      if (isPlayer) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        line(ctx, x - 66, y + 14, x + 68, y + 1, "#c4e837", 4);
        ctx.restore();
      }
      if (running && racer.speed > 0 && !racer.finished && !reducedMotion) {
        for (let i = 0; i < 5; i++) {
          const phase = (racer.x * 0.045 + i / 5) % 1;
          const tailX = x - facing * (85 + phase * (38 + racer.speed * 0.3));
          ctx.save();
          ctx.globalAlpha = (1 - phase) * 0.3;
          line(
            ctx,
            tailX,
            y - 25 - i * 12 - racer.y * 0.4,
            tailX - facing * (18 + racer.speed * 0.25),
            y - 23 - i * 12 - racer.y * 0.4,
            color,
            1.5,
          );
          ctx.restore();
        }
        for (let i = 0; !jumping && i < 7; i++) {
          const phase = (racer.x * 0.045 + i / 7) % 1;
          ctx.save();
          ctx.globalAlpha = (1 - phase) * 0.5;
          ellipse(
            ctx,
            x - facing * (58 + phase * 85),
            y + 2 - phase * (14 + (i % 3) * 7),
            2 + phase * 9,
            1 + phase * 5,
            racer.status === "slowed" ? "#9a876e" : "#b8c6a5",
          );
          ctx.restore();
        }
      }
      if (racer.landing > 0 && !reducedMotion) {
        ctx.save();
        ctx.globalAlpha = racer.landing * 0.65;
        ctx.strokeStyle = "#9eae83";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(
          x - 8,
          y + 1,
          43 + (1 - racer.landing) * 38,
          5 + (1 - racer.landing) * 7,
          -0.1,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      }
      drawAnimal(
        ctx,
        participant.animal.strokes,
        x - RACE_VIEW.animalWidth / 2,
        y - RACE_VIEW.animalHeight - racer.y - racer.bob,
        RACE_VIEW.animalWidth,
        RACE_VIEW.animalHeight,
        {
          color,
          time: t,
          stride: racer.stride,
          speed: racer.speed,
          moving: running && racer.speed > 0 && !racer.finished,
          airborne: racer.y,
          landing: racer.landing,
          ducking: racer.status === "ducking",
          facing,
          tilt: racer.tilt + cornerLean,
          lineWidth: isPlayer ? 4 : 3.5,
        },
      );
      const label = `${isPlayer ? "나 · " : ""}${participant.name}`;
      ctx.font = '700 13px Arial, "Noto Sans KR", sans-serif';
      const labelWidth = Math.min(172, ctx.measureText(label).width + 21);
      const labelY = y - 119 - racer.y - racer.bob;
      ctx.fillStyle = isPlayer ? INK : "#fbfcf4e8";
      ctx.beginPath();
      ctx.roundRect(x - labelWidth / 2, labelY - 17, labelWidth, 25, 5);
      ctx.fill();
      ctx.fillStyle = isPlayer ? "#d8f34d" : color;
      ctx.textAlign = "center";
      ctx.fillText(label, x, labelY, labelWidth - 14);
      if (racer.status !== "running" && !racer.finished) {
        const status = {
          jumping: "폴짝!",
          stumbling: "앗, 부딪혔다!",
          slowed: "조심조심…",
          ducking: "몸을 낮춰요!",
          turning: "코너를 돌아요!",
          sliding: "급회전에 미끄러져요!",
          finished: "",
        }[racer.status];
        ctx.font = '700 12px Arial, "Noto Sans KR", sans-serif';
        ctx.fillStyle = racer.status === "stumbling" ? "#d77843" : "#728759";
        ctx.fillText(status ?? "", x, labelY - 28);
      }
      if (racer.status === "stumbling")
        collisionBurst(ctx, x + 76, y - 49, t, "#ed9b55");
      if (racer.finished) {
        ctx.fillStyle = INK;
        ctx.font = "900 18px Arial, sans-serif";
        ctx.fillText(`${racer.place}위`, x + 99, y - 44);
      }
    });

    paintFence(ctx, camera, true);
    ctx.restore();
    if (running && player.speed > 45 && !player.finished && !reducedMotion) {
      for (let i = 0; i < 14; i++) {
        const phase = (t * 0.9 + i * 0.13) % 1;
        const sx = WIDTH * (1 - phase),
          sy = i % 2 ? 25 + (i % 4) * 13 : 571 + (i % 3) * 13;
        ctx.save();
        ctx.globalAlpha =
          Math.sin(phase * Math.PI) * (player.x > 800 ? 0.32 : 0.16);
        line(ctx, sx, sy, sx + 35 + player.speed * 0.8, sy - 7, "#5b7144", 2);
        ctx.restore();
      }
    }
    ctx.fillStyle = "#fbfcf4e8";
    ctx.beginPath();
    ctx.roundRect(22, HEIGHT - 42, 149, 27, 5);
    ctx.fill();
    ctx.fillStyle = "#6d7d5c";
    ctx.font = "600 11px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `${Math.min(race.distance, Math.floor(player.x))} / ${race.distance} m`,
      34,
      HEIGHT - 24,
    );
    ctx.fillStyle = "#dde6cb";
    ctx.fillRect(32, HEIGHT - 17, 128, 2);
    ctx.fillStyle = "#92ad4b";
    ctx.fillRect(32, HEIGHT - 17, (128 * player.x) / race.distance, 2);

    if (elapsed >= race.duration && completedRef.current !== race) {
      completedRef.current = race;
      onFinish?.();
    }
  }, [race, elapsed, playerId, onFinish]);

  return (
    <div className="race-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`${getTrack(race.trackId).name}. 내 동물을 가까이서 따라가며 점프와 코너 주행을 보여주는 최대 4인 레이싱 트랙`}
      >
        직접 그린 동물들의 장애물 레이싱. 아래 순위표에서 경기 진행 상황을
        확인할 수 있어요.
      </canvas>
    </div>
  );
}
