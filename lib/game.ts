/** All race calculations are deterministic and shared by the browser and room server. */
export const DRAW_WIDTH = 1000;
export const DRAW_HEIGHT = 440;
export const RACE_DISTANCE = 1000;
export const SIMULATION_STEP = 0.05;

export type Point = { x: number; y: number };
export type Stroke = { points: Point[]; color: string };
export type Animal = { name: string; strokes: Stroke[] };
export type ShapeStats = {
  valid: boolean;
  reason?: string;
  /** Geometry measures are 0–1; abilities are 0–100. */
  legLength: number;
  legSpacing: number;
  bodyLength: number;
  bodyHeight: number;
  legCount: number;
  speed: number;
  agility: number;
  stability: number;
  confidence: number;
};
export type Participant = { id: string; name: string; color: string; animal: Animal };
export type ObstacleType = 'hurdle' | 'water' | 'mud' | 'tunnel' | 'rocks';
export type Obstacle = {
  id: string;
  type: ObstacleType;
  x: number;
  width: number;
  /** Relative difficulty, or available headroom for tunnels. */
  height: number;
  label: string;
};
export type RacerStatus = 'running' | 'jumping' | 'stumbling' | 'slowed' | 'ducking' | 'finished';
export type ObstacleEffect = {
  speedMultiplier: number;
  delay: number;
  status: RacerStatus;
  collision: boolean;
  jumpHeight: number;
  explanation: string;
};
export type RacerState = {
  id: string;
  x: number;
  /** Vertical jump and walking bob in screen pixels; tilt in radians. */
  y: number;
  bob: number;
  tilt: number;
  speed: number;
  status: RacerStatus;
  obstacleId?: string;
  finished: boolean;
  place: number;
};
export type RaceFrame = { time: number; racers: RacerState[] };
export type RaceResult = {
  id: string;
  name: string;
  place: number;
  time: number;
  collisions: number;
  jumps: number;
  stats: ShapeStats;
};
export type RaceEvent = {
  racerId: string;
  obstacleId: string;
  time: number;
  effect: ObstacleEffect;
};
export type Race = {
  seed: string;
  distance: number;
  duration: number;
  participants: Participant[];
  course: Obstacle[];
  frames: RaceFrame[];
  results: RaceResult[];
  events: RaceEvent[];
};

const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const round = (n: number, digits = 3) => Number(n.toFixed(digits));
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const invalid = (reason: string): ShapeStats => ({
  valid: false, reason, legLength: 0, legSpacing: 0, bodyLength: 0,
  bodyHeight: 0, legCount: 0, speed: 0, agility: 0, stability: 0, confidence: 0,
});

/** Treat drawings as geometry, so translating/resizing a creature preserves its traits. */
export function analyzeAnimal(strokes: Stroke[]): ShapeStats {
  if (!Array.isArray(strokes) || strokes.length === 0) return invalid('몸통과 다리가 있는 동물을 그려 주세요.');
  if (strokes.length > 128) return invalid('선이 너무 많아요. 조금 더 간단하게 그려 주세요.');
  const samples: Point[] = [];
  let lineLength = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length > 4096) return invalid('그림의 선 데이터를 확인해 주세요.');
    const points = stroke.points;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.y < 0 || point.x > DRAW_WIDTH || point.y > DRAW_HEIGHT) {
        return invalid('캔버스 안에 동물을 그려 주세요.');
      }
      if (i === 0) continue;
      const previous = points[i - 1];
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      lineLength += distance;
      if (lineLength > 50000) return invalid('선이 너무 복잡해요. 몸통과 다리가 보이게 그려 주세요.');
      if (distance === 0) continue;
      const count = Math.max(1, Math.ceil(distance / 4));
      for (let j = 0; j <= count; j++) {
        const t = j / count;
        const p = { x: previous.x + (point.x - previous.x) * t, y: previous.y + (point.y - previous.y) * t };
        samples.push(p);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
    }
  }
  const width = maxX - minX, height = maxY - minY;
  if (samples.length < 16 || lineLength < 100 || width < 55 || height < 55) {
    return invalid('그림이 너무 작아요. 몸통과 다리를 조금 더 크게 그려 주세요.');
  }
  const columns = 100, rows = 64;
  const grid: Set<number>[] = Array.from({ length: rows }, () => new Set<number>());
  const feet = Array.from({ length: columns }, () => 0);
  for (const p of samples) {
    const column = Math.min(columns - 1, Math.floor(((p.x - minX) / width) * columns));
    const row = Math.min(rows - 1, Math.floor(((p.y - minY) / height) * rows));
    grid[row].add(column);
    if (row >= rows * 0.92) feet[column]++;
  }
  // Join the two outlines of each foot, but retain gaps between separate legs.
  const groups: { left: number; right: number; weight: number }[] = [];
  for (let c = 0; c < columns; c++) {
    if (feet[c] === 0) continue;
    const previous = groups[groups.length - 1];
    if (previous && c - previous.right <= 2) {
      previous.right = c;
      previous.weight += feet[c];
    } else groups.push({ left: c, right: c, weight: feet[c] });
  }
  const legs = groups.filter(g => g.weight >= 3 && g.right - g.left < 24);
  if (legs.length < 2 || groups.some(g => g.right - g.left >= 40)) {
    return invalid('몸통 아래로 떨어진 다리를 두 개 이상 그려 주세요.');
  }
  if (legs.length > 8) return invalid('다리가 구분되도록 선을 조금 정리해 주세요.');

  // Broad horizontal coverage finds the belly, even on freehand closed outlines.
  const rowCoverage = grid.map((_, row) => {
    const union = new Set<number>();
    for (let offset = -1; offset <= 1; offset++) {
      for (const c of grid[row + offset] ?? []) union.add(c);
    }
    return union;
  });
  let bodyBottom = 0.53, bodyTop = 0.22;
  const broad = rowCoverage
    .map((coverage, row) => ({ row, coverage: coverage.size }))
    .filter(v => v.row >= rows * 0.16 && v.row <= rows * 0.78 && v.coverage >= 29);
  if (broad.length) {
    bodyBottom = broad[broad.length - 1].row / rows;
    const torsoTop = rowCoverage.findIndex((coverage, row) => row >= rows * 0.16
      && row < bodyBottom * rows && coverage.size >= 10
      && Math.max(...coverage) - Math.min(...coverage) >= 55);
    bodyTop = torsoTop >= 0 ? torsoTop / rows : broad[0].row / rows;
  }
  // Separated sticks are feet, not a torso. Require visible horizontal body coverage.
  if (broad.length === 0) {
    return invalid('몸통과 다리가 구분되도록 그려 주세요.');
  }
  const legLength = round(clamp(1 - bodyBottom, 0.12, 0.78));
  const legSpacing = round(clamp(((legs[legs.length - 1].left + legs[legs.length - 1].right)
    - (legs[0].left + legs[0].right)) / 200, 0.05, 0.96));
  const bodyLength = round(clamp((width / height - 0.65) / 2.25, 0.1, 0.95));
  const bodyHeight = round(clamp(bodyBottom - bodyTop, 0.18, 0.74));
  // More scribbled legs never provide unbounded power: strength caps at four feet.
  const legCount = Math.min(6, legs.length);
  const speed = Math.round(clamp(0.24 + 0.6 * legLength + 0.18 * bodyLength + 0.08 * legSpacing) * 100);
  const agility = Math.round(clamp(0.2 + 0.75 * legLength + 0.16 * (1 - bodyLength)
    - 0.15 * Math.abs(legSpacing - 0.62)) * 100);
  const stability = Math.round(clamp(0.25 + 0.5 * legSpacing + 0.06 * Math.min(legCount, 4)
    - 0.2 * legLength) * 100);
  return {
    valid: true, legLength, legSpacing, bodyLength, bodyHeight, legCount, speed, agility, stability,
    confidence: round(clamp(0.55 + Math.min(broad.length, 12) * 0.025 + Math.min(legCount, 4) * 0.025)),
  };
}

function randomGenerator(seed: string | number) {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return () => {
    hash += 0x6d2b79f5;
    let value = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCourse(seed: string | number): Obstacle[] {
  const random = randomGenerator(seed);
  const types: ObstacleType[] = ['hurdle', 'water', 'mud', 'tunnel', 'rocks'];
  // Every course contains all five mechanics, in a seeded order.
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  types.push((['hurdle', 'water', 'mud', 'tunnel', 'rocks'] as ObstacleType[])[Math.floor(random() * 5)]);
  const labels: Record<ObstacleType, string> = { hurdle: '통나무 허들', water: '물웅덩이', mud: '진흙 구간', tunnel: '낮은 터널', rocks: '울퉁불퉁 돌길' };
  return types.map((type, i) => ({
    id: `obstacle-${i}`,
    type,
    x: 135 + i * 139 + Math.round(random() * 16),
    width: type === 'hurdle' ? 22 : type === 'water' ? 45 + Math.round(random() * 20) : 45 + Math.round(random() * 63),
    height: round(type === 'tunnel' ? 0.38 + random() * 0.22 : 0.43 + random() * 0.21),
    label: labels[type],
  }));
}

/** Shape-to-obstacle rules are explicit so the UI can explain each race event. */
export function obstacleEffect(stats: ShapeStats, obstacle: Obstacle): ObstacleEffect {
  const leg = stats.legLength, spacing = stats.legSpacing;
  const agility = stats.agility / 100, stability = stats.stability / 100;
  if (obstacle.type === 'hurdle') {
    const reach = 0.12 + 0.77 * leg + 0.16 * agility;
    const clears = reach >= obstacle.height;
    return {
      speedMultiplier: clears ? 0.92 : 0.52,
      delay: clears ? 0 : round(0.5 + (obstacle.height - reach) * 3.4),
      status: clears ? 'jumping' : 'stumbling', collision: !clears,
      jumpHeight: clears ? 29 + obstacle.height * 30 : 10,
      explanation: clears ? '긴 다리로 허들을 가볍게 넘었어요!' : '다리가 허들에 걸려 잠깐 멈췄어요.',
    };
  }
  if (obstacle.type === 'water') {
    const reach = 0.10 + 0.58 * leg + 0.32 * spacing + 0.12 * agility;
    const required = 0.4 + (obstacle.width - 40) * 0.008;
    const clears = reach >= required;
    return {
      speedMultiplier: clears ? 0.97 : 0.49,
      delay: clears ? 0 : round(0.32 + (required - reach) * 2),
      status: clears ? 'jumping' : 'slowed', collision: !clears,
      jumpHeight: clears ? 44 : 8,
      explanation: clears ? '넓은 보폭으로 물웅덩이를 넘었어요!' : '보폭이 짧아 물에 첨벙! 속도가 줄었어요.',
    };
  }
  if (obstacle.type === 'mud') {
    const multiplier = clamp(0.25 + 0.6 * stability + 0.12 * leg - 0.1 * stats.bodyLength, 0.38, 0.84);
    return {
      speedMultiplier: round(multiplier), delay: 0, status: 'slowed', collision: false, jumpHeight: 0,
      explanation: stability > 0.68 ? '넓게 벌린 다리로 진흙에서 중심을 잡아요.' : '좁은 다리 간격 때문에 진흙에서 비틀거려요.',
    };
  }
  if (obstacle.type === 'tunnel') {
    const profile = 0.3 + 0.55 * leg + 0.15 * stats.bodyHeight - 0.2 * stats.bodyLength;
    const fits = profile <= obstacle.height;
    return {
      speedMultiplier: fits ? 1 : clamp(0.68 - (profile - obstacle.height) * 3, 0.23, 0.68),
      delay: fits ? 0 : round(0.4 + (profile - obstacle.height) * 8),
      status: fits ? 'running' : 'ducking', collision: !fits, jumpHeight: 0,
      explanation: fits ? '낮은 몸통 덕분에 터널을 쏙 통과해요!' : '키가 커서 터널에 부딪혔어요. 몸을 숙여요!',
    };
  }
  const footing = clamp(0.12 + 0.8 * stability + 0.15 * agility - 0.3 * leg);
  const trips = footing < 0.56;
  return {
    speedMultiplier: round(clamp(0.3 + footing * 0.65, 0.45, 0.91)),
    delay: trips ? round((0.56 - footing) * 3.5 + 0.25) : 0,
    status: trips ? 'stumbling' : 'jumping', collision: trips, jumpHeight: trips ? 5 : 13,
    explanation: trips ? '불안정한 다리가 돌에 걸려 휘청거려요.' : '다리 간격이 안정적이라 돌길도 사뿐사뿐!',
  };
}

export function generateRace(participants: Participant[], seed: string | number): Race {
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 4) {
    throw new Error('레이스에는 1명부터 4명까지 참가할 수 있어요.');
  }
  if (new Set(participants.map(p => p.id)).size !== participants.length) throw new Error('참가자 ID는 서로 달라야 해요.');
  const course = generateCourse(seed);
  const actors = participants.map(participant => {
    const stats = analyzeAnimal(participant.animal.strokes);
    if (!stats.valid) throw new Error(`${participant.name}: ${stats.reason}`);
    const random = randomGenerator(`${seed}:${participant.id}`);
    return {
      participant, stats, x: 0, finishTime: 0, collisions: 0, jumps: 0,
      baseSpeed: 35 + stats.speed * 0.12 + (random() - 0.5) * 0.7,
      phase: random() * Math.PI * 2,
      nextObstacle: 0, delayUntil: 0,
      active: undefined as { obstacle: Obstacle; effect: ObstacleEffect } | undefined,
    };
  });
  const frames: RaceFrame[] = [];
  const events: RaceEvent[] = [];
  const makeFrame = (time: number): RaceFrame => {
    const ordered = [...actors].sort((a, b) => {
      if (a.finishTime && b.finishTime) return a.finishTime - b.finishTime;
      if (a.finishTime) return -1;
      if (b.finishTime) return 1;
      return b.x - a.x || compareIds(a.participant.id, b.participant.id);
    });
    return {
      time: round(time),
      racers: actors.map(actor => {
        const finished = actor.finishTime > 0;
        const active = actor.active;
        const effect = active?.effect;
        const progress = active ? clamp((actor.x - active.obstacle.x) / active.obstacle.width) : 0;
        const waiting = time < actor.delayUntil;
        const status = finished ? 'finished' : waiting && effect?.collision ? 'stumbling' : effect?.status ?? 'running';
        const y = effect && !waiting ? Math.sin(progress * Math.PI) * effect.jumpHeight : 0;
        const bob = finished ? 0 : Math.sin(time * 13 + actor.phase) * (status === 'slowed' ? 1 : 2.5);
        const tilt = finished ? 0 : status === 'stumbling' ? Math.sin(time * 28) * 0.17
          : status === 'ducking' ? 0.12 : Math.sin(time * 7 + actor.phase) * 0.022;
        return {
          id: actor.participant.id, x: round(actor.x), y: round(y), bob: round(bob), tilt: round(tilt),
          speed: round(finished || waiting ? 0 : actor.baseSpeed * (effect?.speedMultiplier ?? 1)),
          status, ...(active ? { obstacleId: active.obstacle.id } : {}), finished,
          place: ordered.indexOf(actor) + 1,
        };
      }),
    };
  };
  frames.push(makeFrame(0));
  let time = 0;
  for (let step = 1; step <= 2400; step++) {
    const stepStart = (step - 1) * SIMULATION_STEP;
    time = step * SIMULATION_STEP;
    for (const actor of actors) {
      if (actor.finishTime) continue;
      // Split at obstacle edges and delay expiry; no frame-rate-dependent overshoot.
      let remaining = SIMULATION_STEP;
      let cursor = stepStart;
      for (let iteration = 0; remaining > 0.000001 && iteration < 10; iteration++) {
        if (cursor < actor.delayUntil) {
          const wait = Math.min(remaining, actor.delayUntil - cursor);
          cursor += wait; remaining -= wait;
          continue;
        }
        if (actor.active && actor.x >= actor.active.obstacle.x + actor.active.obstacle.width - 0.00001) {
          actor.active = undefined;
          actor.nextObstacle++;
        }
        const next = course[actor.nextObstacle];
        if (!actor.active && next && actor.x >= next.x - 0.00001) {
          const effect = obstacleEffect(actor.stats, next);
          actor.active = { obstacle: next, effect };
          actor.delayUntil = cursor + effect.delay;
          actor.collisions += Number(effect.collision);
          actor.jumps += Number(effect.status === 'jumping');
          events.push({ racerId: actor.participant.id, obstacleId: next.id, time: round(cursor), effect });
          if (effect.delay > 0) continue;
        }
        const boundary = actor.active ? actor.active.obstacle.x + actor.active.obstacle.width : next?.x ?? RACE_DISTANCE;
        const speed = actor.baseSpeed * (actor.active?.effect.speedMultiplier ?? 1);
        const available = Math.max(0, boundary - actor.x);
        const moveTime = Math.min(remaining, available / speed);
        actor.x = Math.min(RACE_DISTANCE, actor.x + moveTime * speed);
        cursor += moveTime; remaining -= moveTime;
        if (actor.x >= RACE_DISTANCE - 0.00001) {
          actor.x = RACE_DISTANCE; actor.finishTime = cursor;
          break;
        }
      }
    }
    frames.push(makeFrame(time));
    if (actors.every(actor => actor.finishTime > 0)) break;
  }
  if (actors.some(actor => actor.finishTime === 0)) throw new Error('레이스 계산을 완료하지 못했어요.');
  const results = [...actors].sort((a, b) => a.finishTime - b.finishTime
    || compareIds(a.participant.id, b.participant.id)).map((actor, index) => ({
    id: actor.participant.id, name: actor.participant.name, place: index + 1,
    time: round(actor.finishTime), collisions: actor.collisions, jumps: actor.jumps, stats: actor.stats,
  }));
  return { seed: String(seed), distance: RACE_DISTANCE, duration: round(time), participants, course, frames, results, events };
}

/** Call with elapsed server-synchronised seconds; supports joining an in-progress race. */
export function sampleRace(race: Race, seconds: number): RaceFrame {
  const time = clamp(Number.isFinite(seconds) ? seconds : 0, 0, race.duration);
  if (time >= race.duration) return race.frames[race.frames.length - 1];
  const index = Math.min(race.frames.length - 1, Math.floor(time / SIMULATION_STEP));
  const before = race.frames[index];
  const after = race.frames[Math.min(index + 1, race.frames.length - 1)];
  const mix = clamp((time - before.time) / SIMULATION_STEP);
  return {
    time,
    racers: before.racers.map((racer, i) => {
      const next = after.racers[i];
      return {
        ...racer,
        x: round(racer.x + (next.x - racer.x) * mix),
        y: round(racer.y + (next.y - racer.y) * mix),
        bob: round(racer.bob + (next.bob - racer.bob) * mix),
        tilt: round(racer.tilt + (next.tilt - racer.tilt) * mix),
      };
    }),
  };
}

const ink = '#34443d';
const line = (points: number[][]): Stroke => ({ color: ink, points: points.map(([x, y]) => ({ x, y })) });

/** Editable drawings, with noticeably different feet, stride, and body proportions. */
export const SAMPLE_ANIMALS: Animal[] = [
  {
    name: '꼬마 번개',
    strokes: [
      line([[195,177],[210,158],[260,147],[410,150],[515,158],[562,149],[575,111],[599,69],[620,89],[650,70],[656,107],[685,119],[733,125],[749,144],[739,163],[699,171],[657,158],[653,209],[632,241],[592,248],[540,238],[460,247],[332,250],[250,244],[213,219],[195,177]]),
      line([[257,245],[248,312],[224,371],[250,379],[272,363],[290,292],[310,250]]),
      line([[347,250],[357,310],[341,365],[371,371],[394,319],[390,250]]),
      line([[522,243],[529,303],[503,370],[532,376],[562,308],[562,242]]),
      line([[596,247],[608,314],[621,371],[652,372],[641,307],[637,236]]),
      line([[207,172],[175,157],[145,175],[129,204],[107,215],[144,217],[174,195],[194,194]]),
      line([[660,122],[665,124],[664,129],[660,129],[660,122]]),
      line([[730,145],[737,146]]),
      line([[579,117],[593,132],[586,151],[600,163],[589,177]]),
    ],
  },
  {
    name: '롱다리',
    strokes: [
      line([[237,140],[264,125],[389,120],[489,125],[562,135],[589,111],[619,67],[645,47],[655,69],[683,60],[687,90],[727,105],[749,125],[736,143],[695,144],[663,132],[640,171],[620,202],[578,211],[491,197],[387,201],[288,195],[249,176],[237,140]]),
      line([[279,191],[260,280],[244,389],[266,393],[289,289],[310,199]]),
      line([[367,201],[387,286],[367,386],[391,392],[416,289],[405,201]]),
      line([[500,201],[510,286],[489,387],[515,392],[542,289],[539,207]]),
      line([[585,209],[608,290],[626,388],[650,389],[640,282],[619,204]]),
      line([[242,143],[207,113],[183,123],[172,147],[141,159],[179,162],[216,143]]),
      line([[686,109],[692,109],[692,115],[686,115],[686,109]]),
    ],
  },
  {
    name: '통통이',
    strokes: [
      line([[183,170],[195,132],[245,107],[310,92],[436,87],[532,99],[575,125],[611,111],[622,77],[643,68],[664,85],[679,108],[716,111],[748,132],[770,166],[766,207],[742,235],[703,245],[678,275],[611,292],[471,303],[312,299],[242,283],[199,247],[180,208],[183,170]]),
      line([[241,283],[225,352],[248,367],[280,365],[296,299]]),
      line([[334,301],[332,351],[351,367],[382,366],[389,304]]),
      line([[531,300],[532,350],[550,367],[580,365],[591,299]]),
      line([[640,287],[644,349],[662,367],[694,364],[688,271]]),
      line([[182,170],[154,152],[133,160],[128,180],[142,194],[179,193]]),
      line([[702,153],[708,153],[708,160],[702,160],[702,153]]),
      line([[752,181],[762,184],[754,191],[752,181]]),
      line([[716,203],[726,210],[737,203]]),
    ],
  },
  {
    name: '깡총이',
    strokes: [
      line([[239,202],[258,159],[304,139],[361,144],[417,158],[482,156],[538,141],[570,119],[575,77],[593,34],[611,31],[617,53],[600,116],[622,126],[635,65],[655,31],[673,38],[670,68],[647,139],[676,163],[697,193],[695,217],[677,230],[647,226],[622,241],[550,250],[465,255],[376,266],[301,267],[264,247],[239,202]]),
      line([[292,264],[275,307],[229,345],[202,351],[206,371],[267,371],[316,323],[339,268]]),
      line([[372,266],[365,312],[331,354],[310,358],[315,376],[364,373],[406,327],[415,260]]),
      line([[537,253],[552,318],[534,361],[554,372],[578,367],[591,320],[576,251]]),
      line([[607,244],[620,309],[642,356],[659,368],[680,357],[656,309],[645,233]]),
      line([[242,196],[215,177],[193,184],[183,203],[194,223],[219,221],[244,207]]),
      line([[651,175],[657,175],[657,182],[651,182],[651,175]]),
      line([[685,204],[693,207],[685,210]]),
    ],
  },
];
