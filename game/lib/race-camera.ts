import { trackPoint, type TrackId } from "./game.ts";

/** Shared oblique view: visible lane depth, raised rails and room for the runners. */
export const RACE_VIEW = {
  width: 1200,
  height: 620,
  pixelsPerMetre: 3.2,
  anchorX: 400,
  centerY: 350,
  laneSpacing: 100,
  animalWidth: 224,
  animalHeight: 132,
  groundSlope: 0.18,
  depthSkew: 0.42,
  depthScale: 0.9,
} as const;

// Open up the bends in the close view instead of stretching lateral world distances.
// Sampling by race distance keeps camera motion independent of rendering frame rate.
const BEND_STRENGTH: Record<TrackId, number> = {
  straight: 0,
  oval: 0.38,
  zigzag: 0.55,
  woodland: 0.55,
};
const SAMPLE_METRES = 2;
type ViewPoint = { x: number; y: number; heading: number };
const angleDelta = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** A continuous local road ribbon, with gentler curvature and unchanged athlete scale. */
export function createRaceCamera(
  trackId: TrackId,
  followMetres: number,
  distance = 1000,
  laneCount = 4,
  width: number = RACE_VIEW.width,
) {
  const follow = Math.max(0, Math.min(distance, followMetres));
  const laneSpacing = 400 / Math.max(4, laneCount);
  const laneScale = laneSpacing / RACE_VIEW.laneSpacing;
  const lateralScale = RACE_VIEW.laneSpacing / 26;
  const metresToPixels = RACE_VIEW.pixelsPerMetre;

  // Apply one ground-plane projection to runners, lanes, rails and obstacles.
  // A parallel projection keeps drawings readable while revealing the track's depth.
  const ground = (x: number, y: number) => ({
    x: RACE_VIEW.anchorX + x + y * RACE_VIEW.depthSkew,
    y: RACE_VIEW.centerY - x * RACE_VIEW.groundSlope + y * RACE_VIEW.depthScale,
  });

  function roadAngle(metres: number) {
    let progress = metres / distance;
    if (trackId === "oval") progress = ((progress % 1) + 1) % 1;
    return trackPoint(trackId, progress).angle;
  }

  // Both halves share the exact player tangent. Unwrap successive headings so the
  // oval's +/-pi seam cannot produce a kink or a sudden camera reversal.
  function integrate(direction: number, count: number) {
    const points: ViewPoint[] = [{ x: 0, y: 0, heading: 0 }];
    let angle = roadAngle(follow),
      heading = 0,
      x = 0,
      y = 0;
    for (let i = 1; i <= count; i++) {
      const nextAngle = roadAngle(follow + direction * i * SAMPLE_METRES);
      const nextHeading =
        heading + angleDelta(nextAngle, angle) * BEND_STRENGTH[trackId];
      const middle = (heading + nextHeading) / 2;
      x += Math.cos(middle) * direction * SAMPLE_METRES * metresToPixels;
      y += Math.sin(middle) * direction * SAMPLE_METRES * metresToPixels;
      points.push({ x, y, heading: nextHeading });
      heading = nextHeading;
      angle = nextAngle;
    }
    return points;
  }

  // Include padding for obstacles and fence posts that straddle the visible range.
  const ahead = trackId === "straight" ? [] : integrate(1, 250);
  const behind = trackId === "straight" ? [] : integrate(-1, 125);

  function project(metres: number, offset = 0) {
    if (trackId === "straight") {
      const forward = (metres - follow) * metresToPixels;
      return ground(forward, offset * lateralScale);
    }
    const delta = metres - follow;
    const points = delta >= 0 ? ahead : behind;
    const index = Math.abs(delta) / SAMPLE_METRES;
    const lower = Math.min(points.length - 1, Math.floor(index));
    const a = points[lower],
      b = points[Math.min(points.length - 1, lower + 1)];
    const mix = Math.min(1, index - lower);
    const heading = a.heading + (b.heading - a.heading) * mix;
    const beyond =
      Math.max(0, index - (points.length - 1)) *
      SAMPLE_METRES *
      Math.sign(delta);
    const x =
      a.x +
      (b.x - a.x) * mix +
      Math.cos(heading) * beyond * metresToPixels -
      Math.sin(heading) * offset * lateralScale;
    const y =
      a.y +
      (b.y - a.y) * mix +
      Math.sin(heading) * beyond * metresToPixels +
      Math.cos(heading) * offset * lateralScale;
    return ground(x, y);
  }

  return {
    trackId,
    width,
    laneCount,
    laneSpacing,
    racerScale: Math.min(1, laneSpacing / 75),
    laneLines: Array.from({ length: laneCount + 1 }, (_, i) =>
      (i * laneSpacing - (laneCount - 1) * laneSpacing / 2 - 60 * laneScale) * 0.26),
    follow,
    from: follow - 200,
    to: follow + 360 + Math.max(0, width - RACE_VIEW.width) / metresToPixels,
    project,
    /** Keep every runner and obstacle on the same projected ground plane. */
    surface: (metres: number, lane: number, across = 0) =>
      project(metres, (lane * laneSpacing - (laneCount - 1) * laneSpacing / 2 + across * laneScale) * 0.26),
  };
}

export type RaceCamera = ReturnType<typeof createRaceCamera>;
