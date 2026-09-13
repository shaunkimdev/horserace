'use client';

import { useEffect, useRef } from 'react';
import { sampleRace, type Obstacle, type Race, type Stroke } from '../lib/game';

type AnimalOptions = {
  color?: string;
  time?: number;
  moving?: boolean;
  ducking?: boolean;
  tilt?: number;
  lineWidth?: number;
};

/** Draw the original strokes, with a small gait deformation below the belly. */
export function drawAnimal(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  x: number,
  y: number,
  width: number,
  height: number,
  options: AnimalOptions = {},
) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      left = Math.min(left, point.x); right = Math.max(right, point.x);
      top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
    }
  }
  if (!Number.isFinite(left) || right <= left || bottom <= top) return;
  const scale = Math.min(width / (right - left), height / (bottom - top));
  const drawnWidth = (right - left) * scale;
  const drawnHeight = (bottom - top) * scale;
  ctx.save();
  ctx.translate(x + width / 2, y + height);
  ctx.rotate(options.tilt ?? 0);
  if (options.ducking) ctx.scale(1.08, 0.78);
  ctx.lineWidth = options.lineWidth ?? 3.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.strokeStyle = options.color ?? stroke.color ?? '#28372d';
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      let px = (point.x - left) * scale - drawnWidth / 2;
      let py = (point.y - top) * scale - drawnHeight;
      const foot = Math.max(0, ((point.y - top) / (bottom - top) - 0.57) / 0.43);
      if (options.moving) {
        const phase = (options.time ?? 0) * 12 + Math.floor((point.x - left) / (right - left) * 5) * 2.2;
        px += Math.sin(phase) * foot * 7;
        py -= Math.max(0, Math.cos(phase)) * foot * 4;
      }
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  ctx.restore();
}

const WIDTH = 1200;
const HEIGHT = 620;
const INK = '#29352d';
const ground = (x: number, lane: number) => 215 + lane * 100 - x * 0.1;

function path(ctx: CanvasRenderingContext2D, points: number[][], fill: string, stroke?: string) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.1, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, x: number, y: number, endX: number, endY: number, color: string, width = 2) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(endX, endY);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function fence(ctx: CanvasRenderingContext2D, baseline: number, camera: number, foreground = false) {
  const rail = foreground ? '#ffffff' : '#fffffb';
  for (const height of [12, 28]) line(ctx, -10, baseline - height, WIDTH + 10, baseline - 122 - height, rail, 5);
  const offset = ((-camera % 146) + 146) % 146;
  for (let x = offset - 146; x < WIDTH + 146; x += 146) {
    const y = baseline - x * 0.1;
    line(ctx, x + 3, y + 2, x + 1, y - 42, '#c9d9b5', 5);
    line(ctx, x, y, x - 2, y - 43, rail, 6);
  }
}

function pennant(ctx: CanvasRenderingContext2D, x: number, y: number, orange: boolean, time: number) {
  line(ctx, x, y, x, y - 62, '#8ba87c', 2.5);
  const flutter = Math.sin(time * 3 + x / 100) * 2;
  path(ctx, [[x, y - 63], [x + 28, y - 66 + flutter], [x + 27, y - 47 + flutter], [x, y - 44]], orange ? '#f59b65' : '#d4ed71');
}

function drawObstacle(ctx: CanvasRenderingContext2D, obstacle: Obstacle, x: number, lane: number, time: number) {
  const width = obstacle.width * 3.2;
  const y = ground(x, lane);
  const farY = y - 39;
  const endY = y - width * 0.1;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (obstacle.type === 'water') {
    path(ctx, [[x, y + 7], [x + width, endY + 7], [x + width, endY - 45], [x, y - 45]], '#c7e4d6', '#a7cfc0');
    path(ctx, [[x + 5, y], [x + width - 5, endY], [x + width - 5, endY - 38], [x + 5, y - 38]], '#9fd4dd');
    for (let i = 0; i < 4; i++) {
      const wx = x + 12 + i * (width - 30) / 4;
      const wy = y - 16 - i % 2 * 11 - (wx - x) * 0.1;
      line(ctx, wx, wy, wx + 17 + Math.sin(time * 2 + i) * 3, wy - 1, '#e6faf4', 2);
    }
  } else if (obstacle.type === 'mud') {
    path(ctx, [[x - 3, y - 3], [x + 16, y + 8], [x + width - 16, endY + 8], [x + width + 5, endY - 8], [x + width - 4, endY - 34], [x + width - 23, endY - 41], [x + 19, farY], [x, y - 29]], '#b7a58a');
    for (let i = 0; i < 7; i++) {
      const mx = x + 19 + i * (width - 34) / 7;
      ellipse(ctx, mx, ground(mx, lane) - 8 - i % 3 * 10, 9 + i % 2 * 6, 2.2, '#8f806b');
    }
  } else if (obstacle.type === 'hurdle') {
    const h = 24 + obstacle.height * 28;
    ellipse(ctx, x + width / 2, y - 7, width / 2 + 15, 8, '#dbe0cd');
    for (const px of [x + 10, x + width - 8]) {
      const py = ground(px, lane);
      line(ctx, px, py - 2, px, py - h, '#82664c', 7);
      line(ctx, px - 8, py, px + 9, py - 2, '#987657', 4);
    }
    line(ctx, x + 4, y - h + 3, x + width, endY - h + 3, '#b88760', 13);
    line(ctx, x + 3, y - h, x + width, endY - h, '#dbad7c', 9);
    for (let i = 0; i < 3; i++) {
      const hx = x + 12 + i * 22;
      line(ctx, hx, ground(hx, lane) - h - 3, hx + 4, ground(hx, lane) - h + 3, '#a17750', 1.5);
    }
  } else if (obstacle.type === 'rocks') {
    for (let i = 0; i < 5; i++) {
      const rx = x + 15 + i * (width - 24) / 5;
      const ry = ground(rx, lane) - (i % 2) * 20;
      const size = 11 + i % 3 * 4;
      ellipse(ctx, rx, ry + 2, size + 4, 4, '#d3d9cb');
      path(ctx, [[rx - size, ry], [rx - size + 3, ry - size], [rx - 1, ry - size - 5], [rx + size - 3, ry - size + 2], [rx + size, ry - 1]], '#a9b6a4', '#8d9f8b');
      path(ctx, [[rx - size + 3, ry - size], [rx - 1, ry - size - 5], [rx + 4, ry - 4], [rx - 5, ry - 5]], '#c5cfbc');
    }
  } else {
    const h = 52;
    ellipse(ctx, x + width / 2, y - 6, width / 2 + 7, 9, '#d2dac2');
    path(ctx, [[x, y], [x, y - h], [x + width, endY - h], [x + width, endY], [x + width - 10, endY], [x + width - 10, endY - h + 13], [x + 10, y - h + 13], [x + 10, y]], '#9aaf82');
    path(ctx, [[x, y - h], [x + 14, y - h - 13], [x + width + 13, endY - h - 13], [x + width, endY - h]], '#c3d1a6');
    path(ctx, [[x + width, endY], [x + width + 13, endY - 13], [x + width + 13, endY - h - 13], [x + width, endY - h]], '#809975');
    line(ctx, x + 13, y - h + 4, x + width - 11, endY - h + 4, '#dbe6c6', 2);
    for (let i = 0; i < 4; i++) {
      const tx = x + 17 + i * (width - 26) / 4;
      line(ctx, tx, ground(tx, lane) - h + 5, tx + 6, ground(tx, lane) - h + 8, '#f4d781', 4);
    }
  }
  ctx.restore();
}

function collisionBurst(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, color: string) {
  ctx.save();
  const phase = time * 11;
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * Math.PI * 2 + phase * 0.06;
    const radius = 15 + Math.sin(phase) * 3;
    line(ctx, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius,
      x + Math.cos(angle) * (radius + 8), y + Math.sin(angle) * (radius + 8), color, 2.5);
  }
  ctx.restore();
}

export type RaceCanvasProps = {
  race: Race;
  elapsed: number;
  playerId: string;
  sound: boolean;
  onFinish?: () => void;
};

export default function RaceCanvas({ race, elapsed, playerId, sound, onFinish }: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completedRef = useRef<Race | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const previousRef = useRef({ race, elapsed: -0.01 });

  useEffect(() => () => { void audioRef.current?.close(); }, []);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const frame = sampleRace(race, elapsed);
    const player = frame.racers.find(racer => racer.id === playerId) ?? frame.racers[0];
    if (!player) return;
    const camera = Math.max(0, player.x * 3.2);
    const project = (world: number) => world * 3.2 - camera + 260;
    const t = Math.max(0, elapsed);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#e5eed3'; ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Field details move with the course; all race geometry uses the same projection.
    for (let i = -1; i < 10; i++) {
      const px = ((i * 182 - camera * 0.8) % 1800 + 1800) % 1800 - 190;
      const py = 92 - px * 0.1;
      if (i % 2 === 0) pennant(ctx, px, py, i % 4 === 0, t);
      line(ctx, px + 50, py - 13, px + 52, py - 20, '#c3d4ae', 1.2);
      line(ctx, px + 52, py - 15, px + 57, py - 19, '#c3d4ae', 1.2);
    }
    path(ctx, [[0, 153], [WIDTH, 33], [WIDTH, 448], [0, 568]], '#d7e2c6');
    path(ctx, [[0, 145], [WIDTH, 25], [WIDTH, 440], [0, 560]], '#fbfcf4');
    for (let lane = 0; lane <= 4; lane++) {
      const ly = 155 + lane * 100;
      line(ctx, 0, ly, WIDTH, ly - 120, lane === 0 || lane === 4 ? '#e6ebdc' : '#e8ecdf', 1.5);
    }
    fence(ctx, 137, camera);

    for (let metres = 0; metres <= race.distance; metres += 100) {
      const x = project(metres);
      if (x < -50 || x > WIDTH + 50) continue;
      const y = 585 - x * 0.1;
      ctx.font = '600 11px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#8fa27e'; ctx.fillText(`${metres} m`, x, y);
      line(ctx, x, y - 20, x, y - 26, '#bccbad', 2);
    }

    const startX = project(0);
    if (startX > -30 && startX < WIDTH + 30) {
      ctx.save(); ctx.setLineDash([7, 9]);
      line(ctx, startX, 145 - startX * 0.1, startX, 555 - startX * 0.1, '#c6d5b5', 2);
      ctx.restore();
    }
    const finishX = project(race.distance);
    if (finishX > -70 && finishX < WIDTH + 100) {
      for (let row = 0; row < 26; row++) {
        for (let col = 0; col < 2; col++) {
          const x = finishX + col * 12;
          const y = 146 + row * 15.6 - x * 0.1;
          path(ctx, [[x, y], [x + 12, y - 1.2], [x + 12, y + 14.4], [x, y + 15.6]], (row + col) % 2 ? '#fafbf1' : '#40503d');
        }
      }
      const fy = 121 - finishX * 0.1;
      line(ctx, finishX, fy, finishX, fy - 65, INK, 3);
      ctx.fillStyle = INK; ctx.fillRect(finishX, fy - 65, 83, 27);
      ctx.fillStyle = '#d6f347'; ctx.font = '800 13px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('FINISH', finishX + 42, fy - 46);
    }

    race.participants.forEach((participant, lane) => {
      for (const obstacle of race.course) {
        const x = project(obstacle.x);
        if (x > -obstacle.width * 3.2 - 80 && x < WIDTH + 80) drawObstacle(ctx, obstacle, x, lane, t);
      }
      const racer = frame.racers.find(item => item.id === participant.id);
      if (!racer) return;
      const x = project(racer.x);
      const y = ground(x, lane);
      if (x < -150 || x > WIDTH + 150) return;
      const isPlayer = participant.id === playerId;
      const color = participant.color || INK;
      const jumping = racer.y > 5;
      ellipse(ctx, x, y + 4, Math.max(30, 64 - racer.y * 0.35), 7 - Math.min(3, racer.y * 0.045), '#d7deca');
      if (isPlayer) {
        ctx.save(); ctx.globalAlpha = 0.75;
        line(ctx, x - 66, y + 14, x + 68, y + 1, '#c4e837', 4);
        ctx.restore();
      }
      if (racer.speed > 0 && !jumping && !racer.finished) {
        for (let i = 0; i < 3; i++) {
          const phase = (t * 2.5 + i / 3) % 1;
          ctx.save(); ctx.globalAlpha = (1 - phase) * 0.5;
          ellipse(ctx, x - 61 - phase * 23, y - 1 - phase * 7, 2 + phase * 4, 1 + phase * 2, '#b8c6a5');
          ctx.restore();
        }
      }
      drawAnimal(ctx, participant.animal.strokes, x - 85, y - 102 - racer.y - racer.bob, 170, 102, {
        color, time: t + lane * 0.8, moving: racer.speed > 0 && !jumping && !racer.finished,
        ducking: racer.status === 'ducking', tilt: racer.tilt, lineWidth: isPlayer ? 4 : 3.5,
      });
      const label = `${isPlayer ? '나 · ' : ''}${participant.name}`;
      ctx.font = '700 13px Arial, "Noto Sans KR", sans-serif';
      const labelWidth = Math.min(172, ctx.measureText(label).width + 21);
      const labelY = y - 119 - racer.y - racer.bob;
      ctx.fillStyle = isPlayer ? INK : '#fbfcf4e8';
      ctx.beginPath(); ctx.roundRect(x - labelWidth / 2, labelY - 17, labelWidth, 25, 5); ctx.fill();
      ctx.fillStyle = isPlayer ? '#d8f34d' : color; ctx.textAlign = 'center';
      ctx.fillText(label, x, labelY, labelWidth - 14);
      if (racer.status !== 'running' && !racer.finished) {
        const status = { jumping: '폴짝!', stumbling: '앗, 부딪혔다!', slowed: '조심조심…', ducking: '몸을 낮춰요!', finished: '' }[racer.status];
        ctx.font = '700 12px Arial, "Noto Sans KR", sans-serif';
        ctx.fillStyle = racer.status === 'stumbling' ? '#d77843' : '#728759';
        ctx.fillText(status ?? '', x, labelY - 28);
      }
      if (racer.status === 'stumbling') collisionBurst(ctx, x + 76, y - 49, t, '#ed9b55');
      if (racer.finished) {
        ctx.fillStyle = INK; ctx.font = '900 18px Arial, sans-serif';
        ctx.fillText(`${racer.place}위`, x + 99, y - 44);
      }
    });

    fence(ctx, 569, camera, true);
    ctx.fillStyle = '#fbfcf4e8'; ctx.beginPath(); ctx.roundRect(22, HEIGHT - 42, 149, 27, 5); ctx.fill();
    ctx.fillStyle = '#6d7d5c'; ctx.font = '600 11px Arial, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${Math.min(race.distance, Math.floor(player.x))} / ${race.distance} m`, 34, HEIGHT - 24);
    ctx.fillStyle = '#dde6cb'; ctx.fillRect(32, HEIGHT - 17, 128, 2);
    ctx.fillStyle = '#92ad4b'; ctx.fillRect(32, HEIGHT - 17, 128 * player.x / race.distance, 2);

    const previous = previousRef.current.race === race ? previousRef.current.elapsed : -0.01;
    const event = race.events.find(item => item.racerId === playerId && item.time > previous && item.time <= t);
    if (sound && event && t - previous < 0.6 && typeof window.AudioContext !== 'undefined') {
      try {
        const audio = audioRef.current ??= new AudioContext();
        void audio.resume().catch(() => {});
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const now = audio.currentTime;
        oscillator.type = event.effect.collision ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(event.effect.collision ? 140 : 470, now);
        oscillator.frequency.exponentialRampToValueAtTime(event.effect.collision ? 60 : 790, now + 0.14);
        gain.gain.setValueAtTime(0.055, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.start(); oscillator.stop(now + 0.2);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      } catch { /* Browsers without audio access can still render the complete race. */ }
    }
    previousRef.current = { race, elapsed: t };
    if (elapsed >= race.duration && completedRef.current !== race) {
      completedRef.current = race;
      onFinish?.();
    }
  }, [race, elapsed, playerId, sound, onFinish]);

  return (
    <div className="race-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="직접 그린 동물들이 허들, 물웅덩이, 진흙, 낮은 터널과 바위를 넘어 달리는 최대 4인 레이싱 트랙"
      >직접 그린 동물들의 장애물 레이싱. 아래 순위표에서 경기 진행 상황을 확인할 수 있어요.</canvas>
    </div>
  );
}
