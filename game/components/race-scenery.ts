import {
  getTrack,
  trackPoint,
  type Obstacle,
  type Point,
  type Race,
} from "../lib/game.ts";
import { RACE_VIEW, type RaceCamera } from "../lib/race-camera.ts";

const INK = "#29352d";
const visible = (p: Point, margin = 180, width: number = RACE_VIEW.width) =>
  p.x > -margin &&
  p.x < width + margin &&
  p.y > -margin &&
  p.y < RACE_VIEW.height + margin;

function polygon(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  fill: string,
  stroke?: string,
) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function line(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  color: string,
  width = 2,
) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function ellipse(
  ctx: CanvasRenderingContext2D,
  p: Point,
  rx: number,
  ry: number,
  color: string,
) {
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, -0.1, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
const raised = (point: Point, height: number) => ({
  x: point.x,
  y: point.y - height,
});

function edge(
  camera: RaceCamera,
  offset: number,
  start = camera.from,
  end = camera.to,
  height = 0,
) {
  const steps = Math.max(2, Math.ceil(Math.abs(end - start) / 3));
  return Array.from({ length: steps + 1 }, (_, i) =>
    raised(camera.project(start + ((end - start) * i) / steps, offset), height),
  );
}
function strokeEdge(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  width: number,
) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function paintFence(
  ctx: CanvasRenderingContext2D,
  camera: RaceCamera,
  foreground = false,
) {
  const offset = foreground ? 53.04 : -59.28;
  for (const height of [12, 28])
    strokeEdge(
      ctx,
      edge(camera, offset, camera.from, camera.to, height),
      "#fffffb",
      5,
    );
  for (let m = Math.floor(camera.from / 46) * 46; m <= camera.to; m += 46) {
    const p = camera.project(m, offset);
    if (!visible(p, 60, camera.width)) continue;
    line(
      ctx,
      { x: p.x + 3, y: p.y + 2 },
      { x: p.x + 1, y: p.y - 42 },
      "#c9d9b5",
      5,
    );
    line(ctx, p, { x: p.x - 2, y: p.y - 43 }, "#fffffb", 6);
  }
}

function paintGate(
  ctx: CanvasRenderingContext2D,
  camera: RaceCamera,
  metres: number,
  finish: boolean,
) {
  if (metres < camera.from || metres > camera.to) return;
  if (!finish) {
    ctx.save();
    ctx.setLineDash([7, 9]);
    line(
      ctx,
      camera.project(metres, -57.2),
      camera.project(metres, 49.4),
      "#c6d5b5",
      2,
    );
    ctx.restore();
    return;
  }
  for (let row = 0; row < 26; row++) {
    for (let col = 0; col < 2; col++) {
      const m = metres + col * 3.75,
        offset = -56.94 + row * 4.056;
      polygon(
        ctx,
        [
          camera.project(m, offset),
          camera.project(m + 3.75, offset),
          camera.project(m + 3.75, offset + 4.056),
          camera.project(m, offset + 4.056),
        ],
        (row + col) % 2 ? "#fafbf1" : "#40503d",
      );
    }
  }
  const p = camera.project(metres, -63.44);
  line(ctx, p, raised(p, 65), INK, 3);
  ctx.fillStyle = INK;
  ctx.fillRect(p.x, p.y - 65, 83, 27);
  ctx.fillStyle = "#d6f347";
  ctx.font = "800 13px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", p.x + 42, p.y - 46);
}

/** Draw the real centerline through a player-relative camera, never fit the whole course. */
export function paintCourse(
  ctx: CanvasRenderingContext2D,
  camera: RaceCamera,
  race: Race,
  time: number,
) {
  ctx.fillStyle = race.trackId === "woodland" ? "#dce8cf" : "#e5eed3";
  ctx.fillRect(0, 0, camera.width, RACE_VIEW.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const track = getTrack(race.trackId);
  for (let m = Math.floor(camera.from / 35) * 35; m <= camera.to; m += 35) {
    for (const side of [-86, 83]) {
      const p = camera.project(m, side + Math.sin(m * 0.3) * 7);
      if (!visible(p, 100, camera.width)) continue;
      if (race.trackId === "woodland") {
        line(ctx, p, raised(p, 36), "#83936b", 5);
        ellipse(ctx, raised(p, 46), 28, 31, "#b4c995");
        ellipse(ctx, { x: p.x - 10, y: p.y - 55 }, 19, 21, "#c7d8ac");
      } else {
        line(ctx, p, { x: p.x + 2, y: p.y - 8 }, "#bfd0ab", 1.5);
        line(ctx, raised(p, 3), { x: p.x + 8, y: p.y - 7 }, "#bfd0ab", 1.5);
      }
      if (side < 0 && Math.abs(m / 35) % 2 === 0) {
        line(ctx, p, raised(p, 62), "#8ba87c", 2.5);
        const flutter = Math.sin(time * 3 + m) * 2;
        polygon(
          ctx,
          [
            raised(p, 63),
            { x: p.x + 28, y: p.y - 66 + flutter },
            { x: p.x + 27, y: p.y - 47 + flutter },
            raised(p, 44),
          ],
          track.color,
        );
      }
    }
  }
  polygon(
    ctx,
    [
      ...edge(camera, -57.2, camera.from, camera.to, -8),
      ...edge(camera, 50.7, camera.to, camera.from, -8),
    ],
    "#d7e2c6",
  );
  polygon(
    ctx,
    [...edge(camera, -57.2), ...edge(camera, 50.7, camera.to, camera.from)],
    "#fbfcf4",
  );
  for (const offset of camera.laneLines)
    strokeEdge(ctx, edge(camera, offset), "#e8ecdf", 1.5);
  paintFence(ctx, camera);
  for (
    let m = Math.ceil(Math.max(0, camera.from) / 100) * 100;
    m <= Math.min(race.distance, camera.to);
    m += 100
  ) {
    const p = camera.project(m, 57.2);
    if (!visible(p, 30, camera.width)) continue;
    ctx.font = "600 11px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fa27e";
    ctx.fillText(`${m} m`, p.x, p.y);
    line(ctx, raised(p, 20), raised(p, 26), "#bccbad", 2);
  }
  if (race.trackId !== "straight") {
    for (
      let m = Math.ceil(Math.max(0, camera.from) / 35) * 35;
      m < Math.min(race.distance, camera.to);
      m += 35
    ) {
      const turn = trackPoint(race.trackId, m / race.distance).turn;
      if (Math.abs(turn) < 0.4) continue;
      const p = raised(camera.project(m, -63), 44);
      if (!visible(p, 40, camera.width)) continue;
      ctx.fillStyle = track.color;
      ctx.beginPath();
      ctx.roundRect(p.x - 14, p.y - 14, 28, 25, 4);
      ctx.fill();
      ctx.font = "800 20px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fffdf4";
      ctx.fillText(turn > 0 ? "↱" : "↰", p.x, p.y + 5);
    }
  }
  if (!track.closed || camera.follow < race.distance / 2)
    paintGate(ctx, camera, 0, false);
  if (!track.closed || camera.follow >= race.distance / 2)
    paintGate(ctx, camera, race.distance, true);
}

/** Obstacles follow the same curved surface; their vertical parts stay upright. */
export function paintObstacle(
  ctx: CanvasRenderingContext2D,
  camera: RaceCamera,
  obstacle: Obstacle,
  lane: number,
  time: number,
) {
  const width = obstacle.width * RACE_VIEW.pixelsPerMetre;
  const p = (u: number, across = 0, height = 0) =>
    raised(
      camera.surface(obstacle.x + u / RACE_VIEW.pixelsPerMetre, lane, across),
      height * camera.racerScale,
    );
  const run = (start: number, end: number, across: number, height = 0) => {
    const count = Math.max(2, Math.ceil(Math.abs(end - start) / 10));
    return Array.from({ length: count + 1 }, (_, i) =>
      p(start + ((end - start) * i) / count, across, height),
    );
  };
  const patch = (
    start: number,
    end: number,
    near: number,
    far: number,
    color: string,
    border?: string,
  ) =>
    polygon(
      ctx,
      [...run(start, end, near), ...run(end, start, far)],
      color,
      border,
    );
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (obstacle.type === "water") {
    patch(0, width, 7, -45, "#c7e4d6", "#a7cfc0");
    patch(5, width - 5, 0, -38, "#9fd4dd");
    for (let i = 0; i < 4; i++) {
      const u = 12 + (i * (width - 30)) / 4,
        v = -16 - (i % 2) * 11;
      line(
        ctx,
        p(u, v),
        p(u + 17 + Math.sin(time * 2 + i) * 3, v),
        "#e6faf4",
        2,
      );
    }
  } else if (obstacle.type === "mud") {
    patch(0, width, 7, -40, "#b7a58a");
    for (let i = 0; i < 7; i++)
      ellipse(
        ctx,
        p(19 + (i * (width - 34)) / 7, -8 - (i % 3) * 10),
        9 + (i % 2) * 6,
        2.2,
        "#8f806b",
      );
  } else if (obstacle.type === "hurdle") {
    const h = 24 + obstacle.height * 28;
    ellipse(ctx, p(width / 2, -7), Math.min(55, width / 2 + 15), 8, "#dbe0cd");
    for (const u of [10, width - 8]) {
      line(ctx, p(u, -2), p(u, 0, h), "#82664c", 7);
      line(ctx, p(u - 8), p(u + 9), "#987657", 4);
    }
    strokeEdge(ctx, run(4, width, 0, h - 3), "#b88760", 13);
    strokeEdge(ctx, run(3, width, 0, h), "#dbad7c", 9);
    for (let i = 0; i < 3; i++)
      line(
        ctx,
        p(12 + i * 22, 0, h + 3),
        p(16 + i * 22, 0, h - 3),
        "#a17750",
        1.5,
      );
  } else if (obstacle.type === "rocks") {
    for (let i = 0; i < 5; i++) {
      const base = p(15 + (i * (width - 24)) / 5, -(i % 2) * 20),
        size = 11 + (i % 3) * 4;
      const rock = (x: number, y: number) => ({ x: base.x + x, y: base.y + y });
      ellipse(ctx, rock(0, 2), size + 4, 4, "#d3d9cb");
      polygon(
        ctx,
        [
          rock(-size, 0),
          rock(-size + 3, -size),
          rock(-1, -size - 5),
          rock(size - 3, -size + 2),
          rock(size, -1),
        ],
        "#a9b6a4",
        "#8d9f8b",
      );
      polygon(
        ctx,
        [
          rock(-size + 3, -size),
          rock(-1, -size - 5),
          rock(4, -4),
          rock(-5, -5),
        ],
        "#c5cfbc",
      );
    }
  } else {
    const h = 52;
    polygon(
      ctx,
      [
        p(0),
        ...run(0, width, 0, h),
        p(width),
        p(width - 10),
        ...run(width - 10, 10, 0, h - 13),
        p(10),
      ],
      "#9aaf82",
    );
    polygon(
      ctx,
      [...run(0, width, 0, h), ...run(width + 13, 14, -13, h)],
      "#c3d1a6",
    );
    polygon(
      ctx,
      [p(width), p(width + 13, -13), p(width + 13, -13, h), p(width, 0, h)],
      "#809975",
    );
    strokeEdge(ctx, run(13, width - 11, 0, h - 4), "#dbe6c6", 2);
    for (let i = 0; i < 4; i++) {
      const u = 17 + (i * (width - 26)) / 4;
      line(ctx, p(u, 0, h - 5), p(u + 6, 0, h - 8), "#f4d781", 4);
    }
  }
  ctx.restore();
}
