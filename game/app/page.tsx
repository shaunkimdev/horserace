"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeAnimal,
  DRAW_HEIGHT,
  DRAW_WIDTH,
  generateRace,
  DEFAULT_TRACK,
  getTrack,
  isTrackId,
  SAMPLE_ANIMALS,
  sampleRace,
  type Animal,
  type Race,
  type Stroke,
  type TrackId,
} from "@/lib/game";
import { ROOM_DEFAULT_CAPACITY, type Room, type RoomAction, type RoomResponse, type RoomSession } from "@/lib/rooms";
import RaceCanvas from "@/components/RaceCanvas";
import TrackPicker from "@/components/TrackPicker";
import RoomCapacity from "@/components/RoomCapacity";
import { RoomConnection } from "@/lib/room-connection";
import { RaceAudio } from "@/lib/race-audio";

const COLORS = ["#272c21", "#ed653b", "#4264e9", "#ac3a8c"];
const COLOR_NAMES = ["먹색", "주황", "파랑", "자주"];
type Stage = "draw" | "lobby" | "race" | "results";
type Credentials = { code: string; playerId: string; token: string };

function paintAnimal(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  color?: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4.5;
  for (const stroke of strokes) {
    ctx.strokeStyle = color || stroke.color;
    ctx.beginPath();
    stroke.points.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.stroke();
  }
}
function AnimalPreview({
  animal,
  color,
}: {
  animal: Animal | null;
  color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintAnimal(ref.current, animal?.strokes || [], color);
  }, [animal, color]);
  return (
    <canvas
      ref={ref}
      width={DRAW_WIDTH}
      height={DRAW_HEIGHT}
      className="animal-preview"
      role="img"
      aria-label={animal?.name || "그리는 중"}
    />
  );
}
function DrawingBoard({
  strokes,
  onChange,
  color,
  onColor,
  onLimit,
}: {
  strokes: Stroke[];
  onChange: (s: Stroke[]) => void;
  color: string;
  onColor: (c: string) => void;
  onLimit: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    active = useRef<Stroke | null>(null),
    pointer = useRef<number | null>(null),
    current = useRef(strokes);
  useEffect(() => {
    current.current = strokes;
    if (canvas.current) paintAnimal(canvas.current, strokes);
  }, [strokes]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(
        Math.max(
          0,
          Math.min(DRAW_WIDTH, ((e.clientX - r.left) / r.width) * DRAW_WIDTH),
        ),
      ),
      y: Math.round(
        Math.max(
          0,
          Math.min(DRAW_HEIGHT, ((e.clientY - r.top) / r.height) * DRAW_HEIGHT),
        ),
      ),
    };
  };
  function finish(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== pointer.current) return;
    if (active.current && active.current.points.length > 1)
      onChange([...current.current, active.current]);
    active.current = null;
    pointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div className="drawing-paper">
      <div className="paper-heading">
        <span>
          <span className="tiny-dot" /> DRAW YOUR ATHLETE
        </span>
        <span>
          오른쪽을 보고 그려주세요 <b>→</b>
        </span>
      </div>
      <canvas
        ref={canvas}
        width={DRAW_WIDTH}
        height={DRAW_HEIGHT}
        role="img"
        aria-label="동물 그리기 캔버스. 몸통과 두 개 이상의 다리를 그리세요. 키보드 사용자는 아래 예시 동물 버튼을 이용하세요."
        onPointerDown={(e) => {
          if (pointer.current !== null || e.button !== 0) return;
          if (
            strokes.length >= 80 ||
            strokes.reduce((n, s) => n + s.points.length, 0) >= 7998
          ) {
            onLimit(
              "그림이 꽉 찼어요. 되돌리기나 지우기로 선을 조금 줄여주세요.",
            );
            return;
          }
          e.preventDefault();
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          active.current = { color, points: [point(e)] };
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== pointer.current || !active.current) return;
          if (
            active.current.points.length >= 1500 ||
            current.current.reduce((n, s) => n + s.points.length, 0) +
              active.current.points.length >=
              8000
          ) {
            finish(e);
            onLimit("긴 선을 저장했어요. 손을 떼고 이어서 그려주세요.");
            return;
          }
          const p = point(e),
            last = active.current.points.at(-1)!;
          if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
          active.current.points.push(p);
          paintAnimal(e.currentTarget, [...current.current, active.current]);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={(e) => {
          if (e.pointerId === pointer.current) finish(e);
        }}
      />
      {!strokes.length && (
        <div className="blank-hint">
          <span>여기에 당신의 선수를 그려주세요.</span>
          <small>잘 그릴 필요는 없어요. 몸통과 다리만 있으면 출전!</small>
        </div>
      )}
      <div className="paper-tools">
        <div className="color-palette" aria-label="펜 색상">
          {COLORS.map((c, i) => (
            <button
              key={c}
              className={`color-swatch ${color === c ? "selected" : ""}`}
              aria-label={`${COLOR_NAMES[i]} 펜`}
              aria-pressed={color === c}
              style={{ "--swatch": c } as React.CSSProperties}
              onClick={() => onColor(c)}
            />
          ))}
          <span className="pen-label">자유롭게, 삐뚤빼뚤.</span>
        </div>
        <div className="drawing-actions">
          <button
            onClick={() => onChange(strokes.slice(0, -1))}
            disabled={!strokes.length}
          >
            ↶ <span>되돌리기</span>
          </button>
          <span className="divider" />
          <button onClick={() => onChange([])} disabled={!strokes.length}>
            × <span>모두 지우기</span>
          </button>
        </div>
      </div>
    </div>
  );
}
function Help({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      onCancel={close}
      aria-label="게임 안내"
    >
      <button className="dialog-close" onClick={close} aria-label="도움말 닫기">
        ×
      </button>
      <span className="eyebrow">A VERY UNSERIOUS SPORT</span>
      <h2>생긴 대로 달립니다.</h2>
      <p>
        그림의 아래쪽 윤곽에서 다리와 몸통 비율을 읽어요. 종을 알아맞히는 AI가
        아니라, 그린 형태를 경주 능력으로 바꾸는 게임입니다.
      </p>
      <div className="help-grid">
        <article>
          <b>01. 다리 길이</b>
          <p>긴 다리는 허들을 넘기 좋지만 돌길에서는 비틀거릴 수 있어요.</p>
        </article>
        <article>
          <b>02. 다리 사이 간격</b>
          <p>
            넓은 간격은 안정적인 착지를, 적당한 간격은 빠른 보폭을 만들어요.
          </p>
        </article>
        <article>
          <b>03. 몸통의 비율</b>
          <p>
            낮은 동물은 터널에 유리해요. 길쭉한 몸은 진흙에서 더 느려질 수
            있어요.
          </p>
        </article>
        <article>
          <b>04. 같은 코스, 다른 결과</b>
          <p>
            달리기와 점프는 자동! 모양을 바꿔 다시 도전하세요. 친구와는 방
            코드를 공유해 함께 출발해요.
          </p>
        </article>
        <article>
          <b>05. 회전도 몸으로 해요</b>
          <p>
            원형 트랙은 넓은 다리 간격, 지그재그는 짧은 몸통에 유리해요.
            급회전에서 균형을 잃으면 미끄러지거나 펜스에 부딪혀요.
          </p>
        </article>
        <article>
          <b>06. 트랙을 바꾸면 전략도</b>
          <p>
            직선의 허들은 긴 다리로, S자 숲길의 낮은 터널은 납작한 체형으로!
            대기방에서는 방장이 트랙을 고르고 모두 다시 준비해요.
          </p>
        </article>
      </div>
      <div className="help-note">
        최소 두 개의 떨어진 다리를 그려주세요. 한 줄로 그리거나 여러 획으로 나눠
        그려도 좋아요. 그림 전체 크기는 능력에 영향을 주지 않아요.
      </div>
      <button className="button dark full" onClick={close}>
        알겠어요. 그려볼게요 <span>→</span>
      </button>
    </dialog>
  );
}

export default function Home({
  offline = false,
  onPlayOnline,
}: {
  offline?: boolean;
  onPlayOnline?: () => void;
} = {}) {
  const [trackId, setTrackId] = useState<TrackId>(DEFAULT_TRACK);
  const [capacity, setCapacity] = useState(ROOM_DEFAULT_CAPACITY);
  const [stage, setStage] = useState<Stage>("draw"),
    [strokes, setStrokes] = useState<Stroke[]>(SAMPLE_ANIMALS[0].strokes),
    [name, setName] = useState("아무튼 말"),
    [color, setColor] = useState(COLORS[0]);
  const [mode, setMode] = useState<"solo" | "friends">("solo"),
    [joinCode, setJoinCode] = useState(""),
    [room, setRoom] = useState<Room | null>(null),
    [session, setSession] = useState<Credentials | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [help, setHelp] = useState(false),
    [sound, setSound] = useState(true);
  const [race, setRace] = useState<Race | null>(null),
    [startedAt, setStartedAt] = useState(0),
    [elapsed, setElapsed] = useState(-3),
    [isMultiplayerRace, setIsMultiplayerRace] = useState(false);
  const connection = useRef<RoomConnection | null>(null);
  const serverOffset = useRef(0),
    activeSeed = useRef(""),
    raceAudio = useRef<RaceAudio | null>(null),
    previousAudioFrame = useRef<{
      race: Race | null;
      time: number;
      landing: number;
    }>({ race: null, time: -1, landing: 0 }),
    lastTick = useRef(-99),
    roomRevision = useRef({ code: "", revision: 0 });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const stats = useMemo(() => analyzeAnimal(strokes), [strokes]);
  const animal: Animal = useMemo(
    () => ({ name: name.trim() || "이름 없는 선수", strokes }),
    [name, strokes],
  );
  const myId = isMultiplayerRace ? session?.playerId || "you" : "you",
    me = room?.players.find((p) => p.id === session?.playerId),
    isHost = room?.hostId === session?.playerId;
  const beep = useCallback(
    (frequency = 440, duration = 0.08) => {
      if (!sound) return;
      const audio = (raceAudio.current ??= new RaceAudio());
      audio.setEnabled(true);
      audio.setVisible(!document.hidden);
      audio.unlock();
      audio.beep(frequency, duration);
    },
    [sound],
  );
  useEffect(() => {
    const visibility = () => raceAudio.current?.setVisible(!document.hidden);
    const appVisibility = (event: Event) => {
      const visible = (event as CustomEvent<{ visible: boolean }>).detail?.visible;
      raceAudio.current?.setVisible(visible === true && !document.hidden);
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("draw-derby-visibility", appVisibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("draw-derby-visibility", appVisibility);
      raceAudio.current?.dispose();
      raceAudio.current = null;
    };
  }, []);
  useEffect(() => {
    raceAudio.current?.stop();
    previousAudioFrame.current = { race: null, time: -1, landing: 0 };
    if (stage === "results") raceAudio.current?.finish();
    return () => raceAudio.current?.stop();
  }, [stage, race]);
  useEffect(() => {
    if (stage !== "race" || !race) return;
    const player = sampleRace(race, elapsed).racers.find((r) => r.id === myId);
    if (!player) return;
    const audio = raceAudio.current;
    audio?.sync(elapsed, player.x / race.distance);
    const previous = previousAudioFrame.current;
    if (
      previous.race === race &&
      elapsed >= 0 &&
      elapsed - previous.time < 0.4 &&
      elapsed > previous.time
    ) {
      const event = race.events.find(
        (e) =>
          e.racerId === myId &&
          e.time > previous.time &&
          e.time <= elapsed &&
          (e.effect.collision || e.effect.status === "jumping"),
      );
      if (event) audio?.effect(event.effect.collision ? "impact" : "jump");
      if (player.landing > 0.15 && previous.landing <= 0.15)
        audio?.effect("land");
    }
    previousAudioFrame.current = {
      race,
      time: elapsed,
      landing: player.landing,
    };
  }, [stage, race, elapsed, myId]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const code = offline ? null : params.get("room");
      if (!offline && params.get("mode") === "friends") setMode("friends");
      if (code) {
        setJoinCode(code.toUpperCase().slice(0, 6));
        setMode("friends");
      }
      try {
        const savedTrack = localStorage.getItem("draw-derby-track");
        if (isTrackId(savedTrack)) setTrackId(savedTrack);
        const draft = JSON.parse(
          localStorage.getItem("draw-derby-draft") || "null",
        );
        if (
          draft &&
          Array.isArray(draft.strokes) &&
          analyzeAnimal(draft.strokes).valid
        ) {
          setStrokes(draft.strokes);
          setName(String(draft.name || "아무튼 말").slice(0, 20));
        }
        const stored = JSON.parse(
          sessionStorage.getItem("draw-derby-room") || "null",
        );
        if (
          !offline &&
          stored?.code &&
          stored?.token &&
          stored?.playerId &&
          (!code || code.toUpperCase() === stored.code)
        ) {
          setSession(stored);
          setStage("lobby");
        }
      } catch {
        /* Private browsing can disable storage. */
      }
      setDraftLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [offline]);
  useEffect(() => {
    if (!draftLoaded) return;
    const importDraft = (event: Event) => {
      // Native mode switches carry only the drawing and track, never room tokens.
      // Ignore imports while a live room or race is in progress.
      if (stage !== "draw" || session) return;
      try {
        const data = (event as CustomEvent).detail;
        const draft = data?.draft;
        if (draft && Array.isArray(draft.strokes) && analyzeAnimal(draft.strokes).valid) {
          setStrokes(draft.strokes);
          setName(String(draft.name || "아무튼 말").slice(0, 20));
        }
        if (isTrackId(data?.track)) setTrackId(data.track);
      } catch {
        // Invalid or incomplete saved drawings leave the current animal intact.
      }
    };
    document.addEventListener("draw-derby-import", importDraft);
    document.documentElement.dataset.derbyReady = "true";
    return () => {
      document.removeEventListener("draw-derby-import", importDraft);
      delete document.documentElement.dataset.derbyReady;
    };
  }, [draftLoaded, stage, session]);
  useEffect(() => {
    if (!draftLoaded || !stats.valid) return;
    try {
      localStorage.setItem("draw-derby-draft", JSON.stringify(animal));
    } catch {
      /* Optional draft. */
    }
  }, [animal, stats.valid, draftLoaded]);
  useEffect(() => {
    if (draftLoaded) {
      try {
        localStorage.setItem("draw-derby-track", trackId);
      } catch {
        /* Optional preference. */
      }
    }
  }, [trackId, draftLoaded]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const applyRoom = useCallback((data: RoomResponse, sentAt?: number) => {
    if (
      roomRevision.current.code === data.room.code &&
      data.revision < roomRevision.current.revision
    )
      return;
    roomRevision.current = { code: data.room.code, revision: data.revision };
    if (sentAt !== undefined) serverOffset.current = data.serverNow - (sentAt + Date.now()) / 2;
    setError((previous) =>
      previous.startsWith("연결이 잠시 끊겼어요.") ? "" : previous,
    );
    setRoom(data.room);
    setTrackId(data.room.trackId ?? DEFAULT_TRACK);
    const snapshot = data.room.race;
    if (snapshot && activeSeed.current !== snapshot.seed) {
      activeSeed.current = snapshot.seed;
      setRace(
        generateRace(
          snapshot.players,
          snapshot.seed,
          snapshot.trackId ?? DEFAULT_TRACK,
        ),
      );
      setStartedAt(snapshot.startedAt);
      setElapsed(
        (Date.now() + serverOffset.current - snapshot.startedAt) / 1000,
      );
      setIsMultiplayerRace(true);
      setStage("race");
      lastTick.current = -99;
    } else if (!snapshot && activeSeed.current && data.room.phase === "lobby") {
      activeSeed.current = "";
      setRace(null);
      setStage("lobby");
    }
  }, []);
  function remember(data: RoomSession) {
    const credentials = {
      code: data.room.code,
      token: data.token,
      playerId: data.playerId,
    };
    setSession(credentials);
    try {
      sessionStorage.setItem("draw-derby-room", JSON.stringify(credentials));
    } catch {
      /* Session remains usable. */
    }
  }
  function forget() {
    connection.current?.stop();
    connection.current = null;
    setSession(null);
    setRoom(null);
    activeSeed.current = "";
    try {
      sessionStorage.removeItem("draw-derby-room");
    } catch {
      /* Optional storage. */
    }
  }
  useEffect(() => {
    if (!session) return;
    const transport = new RoomConnection(session, {
      state: data => applyRoom(data),
      clock: offset => { serverOffset.current = offset; },
      status: connected => setError(previous => connected
        ? (previous.startsWith("연결이 잠시 끊겼어요.") ? "" : previous)
        : "연결이 잠시 끊겼어요. 자동으로 다시 연결하고 있어요."),
      ended: message => { forget(); setStage("draw"); setError(message); },
    });
    connection.current = transport;
    transport.start();
    const resume = () => { if (!document.hidden) transport.resume(); };
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("draw-derby-visibility", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("draw-derby-visibility", resume);
      transport.stop();
      if (connection.current === transport) connection.current = null;
    };
  }, [session, applyRoom]);
  useEffect(() => {
    if (stage !== "race" || !race) return;
    let handle: number,
      last = 0;
    function frame(now: number) {
      if (now - last >= 1000 / 60 - 1) {
        const t =
          (Date.now() +
            (isMultiplayerRace ? serverOffset.current : 0) -
            startedAt) /
          1000;
        setElapsed(t);
        last = now;
        const tick = Math.ceil(t);
        if (t <= 0.3 && tick !== lastTick.current) {
          beep(t >= 0 ? 780 : 420, 0.11);
          lastTick.current = tick;
        }
        if (t >= race!.duration + 0.5) {
          setStage("results");
          return;
        }
      }
      handle = requestAnimationFrame(frame);
    }
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [stage, race, startedAt, isMultiplayerRace, beep]);
  async function openRoom(join = false) {
    if (!stats.valid) {
      setError(stats.reason || "몸통과 다리를 그려주세요.");
      return;
    }
    if (join && joinCode.length !== 6) {
      setError("6자리 방 코드를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    beep();
    const sentAt = Date.now();
    try {
      const response = await fetch(join ? "/api/rooms/join" : "/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: animal.name,
          animal,
          ...(!join ? { trackId, capacity } : {}),
          ...(join ? { code: joinCode } : {}),
        }),
      });
      const data = (await response.json()) as RoomSession & { error?: string };
      if (!response.ok) throw new Error(data.error || "방을 열지 못했어요.");
      remember(data);
      applyRoom(data, sentAt);
      if (!data.room.race) setStage("lobby");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "연결을 확인하고 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function roomAction(action: RoomAction) {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    beep();
    const sentAt = Date.now();
    try {
      if (!connection.current) throw new Error("서버에 연결하고 있어요. 잠시 후 시도해 주세요.");
      const data = await connection.current.action(action);
      if (action.action === "leave") {
        forget();
        setStage("draw");
        setRace(null);
      } else {
        if ("room" in data) applyRoom(data, sentAt);
        if (action.action === "animal") setStage("lobby");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  function practice() {
    if (!stats.valid) {
      setError(stats.reason || "몸통과 다리를 그려주세요.");
      return;
    }
    beep();
    setError("");
    setIsMultiplayerRace(false);
    const participants = [
      { id: "you", name: animal.name, color, animal },
      ...SAMPLE_ANIMALS.slice(1).map((a, i) => ({
        id: `bot-${i}`,
        name: a.name,
        color: COLORS[i + 1],
        animal: a,
      })),
    ];
    const seed =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setRace(generateRace(participants, seed, trackId));
    setElapsed(-3);
    setStartedAt(Date.now() + 3000);
    lastTick.current = -99;
    setStage("race");
  }
  async function shareRoom() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/?room=${room.code}`,
      );
      setNotice("초대 링크를 복사했어요. 친구에게 보내주세요!");
    } catch {
      setNotice(`방 코드 ${room.code}를 친구에게 알려주세요.`);
    }
  }
  const frame = race ? sampleRace(race, Math.max(0, elapsed)) : null,
    standings = frame?.racers.slice().sort((a, b) => a.place - b.place) || [],
    myRacer = frame?.racers.find((r) => r.id === myId),
    myResult = race?.results.find((r) => r.id === myId),
    latestEvent = race?.events
      .filter(
        (e) => e.racerId === myId && e.time <= elapsed && e.time > elapsed - 3,
      )
      .at(-1);
  return (
    <main className={`app-shell stage-${stage}`}>
      <header className="site-header">
        <button
          className="wordmark"
          onClick={() => {
            if (stage === "draw") return;
            if (room) setStage(room.race ? "race" : "lobby");
            else setStage("draw");
          }}
          aria-label="Draw Derby 홈"
        >
          <span className="checker-icon" />
          DRAW DERBY<span className="logo-period">®</span>
        </button>
        <div className="header-right">
          <span className="edition">A VERY UNSERIOUS SPORT.</span>
          <button
            className={`sound-button ${sound && stage === "race" && elapsed >= 0 ? "is-playing" : ""}`}
            onClick={() => {
              const enabled = !sound;
              setSound(enabled);
              const audio = (raceAudio.current ??= new RaceAudio());
              audio.setEnabled(enabled);
              if (enabled) {
                audio.setVisible(!document.hidden);
                audio.unlock();
                setNotice("배경음악과 효과음을 켰어요.");
              }
            }}
            aria-pressed={sound}
            aria-label={
              sound ? "배경음악과 효과음 끄기" : "배경음악과 효과음 켜기"
            }
            title="경주 배경음악 · 점프와 충돌 효과음"
          >
            <span className="sound-bars" aria-hidden="true">
              <i />
              <i />
              <i />
              {!sound && <em />}
            </span>
            소리 {sound ? "켜짐" : "꺼짐"}
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          <button aria-label="알림 닫기" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="toast">
          {notice}
        </div>
      )}
      {stage === "draw" && (
        <>
          <section className="hero">
            <div>
              <div className="eyebrow">
                <span className="live-dot" /> NO TALENT REQUIRED. JUST LEGS.
              </div>
              <h1>
                Draw a horse.
                <br />
                <span>Then race it.</span>
              </h1>
            </div>
            <div className="hero-aside">
              <div className="player-dots">
                {COLORS.map((c, i) => (
                  <span key={c} style={{ background: c }}>
                    {i + 1}
                  </span>
                ))}
                <b>1–4 PLAYERS</b>
              </div>
              <p>
                말이 아니어도 괜찮아요.
                <br />
                당신의 낙서가 선수가 됩니다.
              </p>
              <button className="text-link" onClick={() => setHelp(true)}>
                어떻게 달리나요? <span>↗</span>
              </button>
            </div>
          </section>
          <DrawingBoard
            strokes={strokes}
            onChange={setStrokes}
            color={color}
            onColor={setColor}
            onLimit={setNotice}
          />
          <section className="athlete-strip" aria-label="그림 분석 결과">
            <span className="analysis-label">
              <span className={`tiny-dot ${stats.valid ? "" : "muted"}`} />
              {stats.valid ? "선수 분석 완료" : "선수를 그려주세요"}
            </span>
            {stats.valid ? (
              <>
                <div className="stat">
                  <span>다리 길이</span>
                  <b>
                    {stats.legLength > 0.46
                      ? "롱다리"
                      : stats.legLength > 0.3
                        ? "적당해요"
                        : "숏다리"}
                  </b>
                  <span className="mini-meter">
                    <i style={{ width: `${stats.legLength * 100}%` }} />
                  </span>
                </div>
                <div className="stat">
                  <span>다리 간격</span>
                  <b>
                    {stats.legSpacing > 0.6
                      ? "넓어요"
                      : stats.legSpacing > 0.35
                        ? "균형 잡힘"
                        : "좁아요"}
                  </b>
                  <span className="mini-meter">
                    <i style={{ width: `${stats.legSpacing * 100}%` }} />
                  </span>
                </div>
                <div className="stat">
                  <span>안정성</span>
                  <b>
                    {stats.stability}
                    <small>/100</small>
                  </b>
                  <span className="mini-meter">
                    <i style={{ width: `${stats.stability}%` }} />
                  </span>
                </div>
              </>
            ) : (
              <span className="analysis-hint">
                {stats.reason || "몸통과 두 개 이상의 다리를 그려주세요."}
              </span>
            )}
            <button
              className="info-circle"
              onClick={() => setHelp(true)}
              aria-label="형태 분석 도움말"
            >
              ?
            </button>
          </section>
          <TrackPicker
            selected={trackId}
            onSelect={setTrackId}
            stats={stats}
            disabled={!!session}
          />
          <section className="entry-controls">
            <label className="name-field">
              <span>
                선수 이름 <small>NAME YOUR ATHLETE</small>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="아무튼 말"
                aria-label="선수 이름"
              />
            </label>
            <div className="race-mode">
              <span className="field-caption">
                함께하면 더 이상하고, 더 재밌어요.
              </span>
              <div className="mode-tabs">
                <button
                  className={mode === "solo" ? "active" : ""}
                  onClick={() => setMode("solo")}
                  disabled={!!session}
                >
                  혼자 연습 <small>+ AI 3</small>
                </button>
                <button
                  className={mode === "friends" ? "active" : ""}
                  onClick={() => offline ? onPlayOnline?.() : setMode("friends")}
                  disabled={!!session}
                >
                  친구와 경주 <small>최대 8인</small>
                </button>
              </div>
            </div>
            <button
              className="button dark start-button"
              disabled={busy || !stats.valid}
              onClick={() =>
                session
                  ? void roomAction({ action: "animal", animal })
                  : mode === "solo"
                    ? practice()
                    : void openRoom(false)
              }
            >
              {busy
                ? "연결하는 중…"
                : session
                  ? "선수 저장하기"
                  : mode === "solo"
                    ? "자, 달려볼까요?"
                    : "새 대기방 만들기"}
              <span>→</span>
            </button>
          </section>
          {mode === "friends" && !session && (
            <RoomCapacity value={capacity} onChange={setCapacity} disabled={busy} />
          )}
          {mode === "friends" && !session && (
            <form
              className="join-panel"
              onSubmit={(e) => {
                e.preventDefault();
                void openRoom(true);
              }}
            >
              <div>
                <b>이미 친구가 방을 만들었나요?</b>
                <span>초대받은 6자리 코드를 입력하세요.</span>
              </div>
              <div className="join-input">
                <input
                  aria-label="6자리 방 코드"
                  placeholder="방 코드 6자리"
                  value={joinCode}
                  maxLength={6}
                  onChange={(e) =>
                    setJoinCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                    )
                  }
                />
                <button
                  className="button outline"
                  disabled={busy || joinCode.length !== 6 || !stats.valid}
                >
                  참가하기 ↗
                </button>
              </div>
            </form>
          )}
          <div className="borrow-row">
            <span>빈 종이가 막막하다면?</span>
            {SAMPLE_ANIMALS.map((a, i) => (
              <button
                key={a.name}
                onClick={() => {
                  setStrokes(a.strokes.map((s) => ({ ...s, color })));
                  setName(a.name);
                  setError("");
                }}
              >
                {["말 한 마리 빌리기", "롱다리", "길쭉이", "폴짝이"][i]}
                <span>↗</span>
              </button>
            ))}
          </div>
          <section className="course-note">
            <span className="eyebrow">SAME TRACK. DIFFERENT CREATURES.</span>
            <p>
              허들, 물웅덩이, 진흙, 낮은 터널, 돌길.
              <br />
              <strong>어떻게 그렸느냐에 따라, 다르게 달려요.</strong>
            </p>
            <div className="obstacle-chips">
              <span>⌁ 허들</span>
              <span>≈ 물웅덩이</span>
              <span>▧ 진흙</span>
              <span>⊓ 터널</span>
              <span>∴ 돌길</span>
            </div>
          </section>
        </>
      )}
      {stage === "lobby" && (
        <section className="lobby">
          <div className="section-top">
            <span className="eyebrow">THE QUESTIONABLE DERBY</span>
            <button
              className="text-link"
              disabled={busy}
              onClick={() => void roomAction({ action: "leave" })}
            >
              대기방 나가기 ↗
            </button>
          </div>
          <div className="lobby-title">
            <div>
              <h1>선수들, 모이세요.</h1>
              <p>각자의 낙서로, 하나의 출발선에. 모두 준비되면 출발합니다.</p>
            </div>
            {room && (
              <button
                className="room-code"
                onClick={() => void shareRoom()}
                aria-label={`방 코드 ${room.code}, 초대 링크 복사`}
              >
                <small>ROOM CODE · 초대 링크 복사</small>
                <strong>{room.code}</strong>
                <span>↗</span>
              </button>
            )}
          </div>
          <TrackPicker
            selected={room?.trackId ?? trackId}
            onSelect={(id) => void roomAction({ action: "track", trackId: id })}
            stats={analyzeAnimal(me?.animal?.strokes ?? strokes)}
            disabled={busy || !isHost}
            lobby
          />
          <RoomCapacity
            value={room?.capacity ?? ROOM_DEFAULT_CAPACITY}
            occupied={room?.players.length}
            disabled={busy || !isHost}
            hostOnly={!isHost}
            onChange={(value) => void roomAction({ action: "capacity", capacity: value })}
          />
          <div className="lobby-grid">
            {Array.from({ length: room?.capacity ?? ROOM_DEFAULT_CAPACITY }, (_, i) => {
              const p = room?.players[i];
              return (
                <article
                  key={p?.id || i}
                  className={`player-card ${!p ? "empty" : ""}`}
                  style={
                    {
                      "--player-color": p?.color || "#879076",
                    } as React.CSSProperties
                  }
                >
                  <div className="player-card-top">
                    <span>PLAYER 0{i + 1}</span>
                    <b>
                      {p
                        ? p.id === room?.hostId
                          ? "HOST"
                          : p.id === session?.playerId
                            ? "YOU"
                            : "GUEST"
                        : "OPEN"}
                    </b>
                  </div>
                  {p ? (
                    <>
                      <AnimalPreview animal={p.animal} color={p.color} />
                      <h3>
                        {p.name}
                        {p.id === session?.playerId && <small>나</small>}
                      </h3>
                      <span
                        className={`ready-status ${p.ready ? "is-ready" : ""}`}
                      >
                        <i />
                        {!p.connected
                          ? "다시 연결하는 중"
                          : p.ready
                            ? "준비 완료!"
                            : "출발 준비 중"}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="empty-plus">+</div>
                      <h3>친구를 기다리는 중</h3>
                      <span className="ready-status">
                        방 코드를 공유해 주세요
                      </span>
                    </>
                  )}
                </article>
              );
            })}
          </div>
          <div className="lobby-bottom">
            <div className="lobby-helper">
              <span className="live-dot" />
              <p>
                <b>{room?.players.length || 0}/{room?.capacity ?? ROOM_DEFAULT_CAPACITY}명 입장</b>
                <span>최소 2명부터 출발할 수 있어요.</span>
              </p>
            </div>
            <div className="lobby-buttons">
              <button
                className="button outline"
                disabled={busy || !me || me.ready}
                onClick={() => {
                  if (me?.animal) {
                    setStrokes(me.animal.strokes);
                    setName(me.name);
                  }
                  setStage("draw");
                }}
              >
                내 선수 다시 그리기
              </button>
              <button
                className={`button ${me?.ready ? "outline" : "dark"}`}
                disabled={busy || !me?.animal}
                onClick={() =>
                  void roomAction({ action: "ready", ready: !me?.ready })
                }
              >
                {me?.ready ? "준비 취소" : "준비됐어요 ✓"}
              </button>
              {isHost && (
                <button
                  className="button dark"
                  disabled={
                    busy ||
                    !room ||
                    room.players.length < 2 ||
                    room.players.some((p) => !p.ready || !p.connected)
                  }
                  onClick={() => void roomAction({ action: "start" })}
                >
                  함께 출발하기 →
                </button>
              )}
            </div>
          </div>
          {!isHost && me?.ready && (
            <p className="waiting-note">
              방장이 출발 버튼을 누르면 함께 달려요.
            </p>
          )}
        </section>
      )}
      {stage === "race" && race && (
        <section className="race-section">
          <div className="section-top">
            <span className="eyebrow">
              {isMultiplayerRace
                ? `ROOM ${room?.code} · LIVE DERBY`
                : "PRACTICE DERBY · YOU + 3 AI"}
            </span>
            <span className="race-timer">
              {Math.max(0, elapsed).toFixed(1)} <small>SEC</small>
            </span>
          </div>
          <div className="race-title">
            <h1>
              {animal.name}
              <span>의 우당탕 경주</span>
            </h1>
            <span className="live-badge">
              <span className="live-dot" />
              {elapsed < 0 ? "GET READY" : "ON TRACK"}
            </span>
          </div>
          <div className="race-track-banner">
            <b>{getTrack(race.trackId).name}</b>
            <span>{getTrack(race.trackId).advantage}에 유리</span>
            {elapsed >= 0 && myRacer && !myRacer.finished && (
              <strong
                className={`race-energy ${myRacer.x >= 800 ? "is-sprint" : ""}`}
              >
                {myRacer.x >= 800 ? "마지막 200m · 끝까지 달려!" : "전력 질주!"}
              </strong>
            )}
          </div>
          <div className="race-stage">
            <RaceCanvas race={race} elapsed={elapsed} playerId={myId} />
            <div className="live-standings">
              {standings.map((s, i) => {
                const p = race.participants.find((p) => p.id === s.id)!;
                return (
                  <div key={s.id} className={s.id === myId ? "is-me" : ""}>
                    <b>{i + 1}</b>
                    <i style={{ background: p.color }} />
                    <span>{p.name}</span>
                    {s.id === myId && <small>YOU</small>}
                  </div>
                );
              })}
            </div>
            {elapsed < 0.5 && (
              <div className="countdown" aria-live="assertive">
                <span>{elapsed < 0 ? "준비됐나요?" : "LET’S GO!"}</span>
                <strong>{elapsed < 0 ? Math.ceil(-elapsed) : "GO!"}</strong>
              </div>
            )}
          </div>
          <div className="race-progress">
            <span>START</span>
            <div>
              <i
                style={{
                  width: `${Math.min(100, ((frame?.racers.find((r) => r.id === myId)?.x || 0) / race.distance) * 100)}%`,
                }}
              />
            </div>
            <strong>
              {Math.min(
                1000,
                Math.round(frame?.racers.find((r) => r.id === myId)?.x || 0),
              )}
              <small> / 1,000 m</small>
            </strong>
            <span className="checker-icon" />
          </div>
          <div className="race-comment" role="status">
            {latestEvent
              ? latestEvent.effect.explanation
              : elapsed < 0
                ? "각자의 생김새대로 달릴 준비 중…"
                : "점프와 달리기는 자동이에요. 당신이 그린 다리를 믿어보세요."}
          </div>
        </section>
      )}
      {stage === "results" && race && (
        <section className="results">
          <span className="eyebrow">EVERY DOODLE HAS ITS DAY.</span>
          <div className="result-heading">
            <div>
              <span className="result-kicker">
                {myResult?.place === 1
                  ? "우승도 낙서에서 시작됩니다."
                  : "폼은 달라도, 완주는 멋지니까."}
              </span>
              <h1>
                {myResult?.place === 1
                  ? "이 낙서, 제법인데요?"
                  : "끝까지 잘 달렸어요."}
              </h1>
              <p>
                당신의 선수는 <strong>{myResult?.place}위</strong>로 들어왔어요.
                다리를 바꾸면 다음 경주도 달라져요.
              </p>
            </div>
            <div className="place-stamp">
              <strong>{myResult?.place}</strong>
              <span>PLACE</span>
            </div>
          </div>
          <div className="race-track-banner">
            <b>{getTrack(race.trackId).name}</b>
            <span>{getTrack(race.trackId).subtitle}</span>
          </div>
          <div className="results-table">
            <div className="results-table-head">
              <span>순위 / 선수</span>
              <span>완주 기록</span>
              <span>충돌</span>
              <span>점프</span>
            </div>
            {race.results.map((r) => {
              const p = race.participants.find((p) => p.id === r.id)!;
              return (
                <div
                  className={`result-row ${r.id === myId ? "is-me" : ""}`}
                  key={r.id}
                >
                  <div className="result-person">
                    <b className="rank">{String(r.place).padStart(2, "0")}</b>
                    <AnimalPreview animal={p.animal} color={p.color} />
                    <strong>{r.name}</strong>
                    {r.id === myId && <span className="you-tag">YOU</span>}
                  </div>
                  <strong>
                    {r.time.toFixed(2)}
                    <small>초</small>
                  </strong>
                  <span>{r.collisions}회</span>
                  <span>{r.jumps}회</span>
                </div>
              );
            })}
          </div>
          <div className="result-insight">
            <span>↗</span>
            <p>
              <b>다음 경주를 위한 작은 힌트</b>
              {race.events.find((e) => e.racerId === myId && e.effect.collision)
                ?.effect.explanation ||
                "균형 잡힌 다리로 코스를 잘 통과했어요. 다른 모양과 코스에서도 실험해 보세요."}
            </p>
          </div>
          <div className="result-actions">
            {isMultiplayerRace ? (
              <>
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() => void roomAction({ action: "leave" })}
                >
                  경주 나가기
                </button>
                {isHost ? (
                  <button
                    className="button dark"
                    disabled={busy}
                    onClick={() => void roomAction({ action: "rematch" })}
                  >
                    대기방에서 다시 모이기 →
                  </button>
                ) : (
                  <p>방장이 다시 경주를 열면 대기방으로 이동해요.</p>
                )}
              </>
            ) : (
              <>
                <button
                  className="button outline"
                  onClick={() => {
                    setStage("draw");
                    setRace(null);
                  }}
                >
                  선수·트랙 바꾸기 ↶
                </button>
                <button className="button dark" onClick={practice}>
                  한 번 더 달리기 →
                </button>
              </>
            )}
          </div>
        </section>
      )}
      <footer>
        <span>DRAW A LITTLE. RACE A LOT.</span>
        <span>그림 실력은 선택. 다리는 필수.</span>
        <button onClick={() => setHelp(true)}>게임 안내 ↗</button>
      </footer>
      {help && <Help close={() => setHelp(false)} />}
    </main>
  );
}
