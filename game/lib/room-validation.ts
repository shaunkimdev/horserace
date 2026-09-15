import { analyzeAnimal, type Animal, type Stroke } from "./game";
import { ROOM_MIN_CAPACITY, ROOM_MAX_CAPACITY } from "./rooms";
export const MAX_ROOM_BODY_BYTES = 180_000;
export class RoomError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RoomError(400, "요청 형식을 확인해 주세요.");
  return value as Record<string, unknown>;
}

function name(value: unknown, fallback?: string, limit = 20): string {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== "string")
    throw new RoomError(400, "이름을 입력해 주세요.");
  const clean = Array.from(value)
    .filter(
      (character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
    .join("")
    .trim();
  if (!clean || clean.length > limit)
    throw new RoomError(400, `이름을 1~${limit}자로 입력해 주세요.`);
  return clean;
}

export function sanitizeAnimal(value: unknown): Animal {
  const animal = object(value);
  if (
    !Array.isArray(animal.strokes) ||
    animal.strokes.length < 1 ||
    animal.strokes.length > 80
  ) {
    throw new RoomError(400, "동물을 1~80개의 선으로 그려 주세요.");
  }
  let pointCount = 0;
  const strokes: Stroke[] = animal.strokes.map((value) => {
    const stroke = object(value);
    if (
      !Array.isArray(stroke.points) ||
      stroke.points.length < 2 ||
      stroke.points.length > 1500
    ) {
      throw new RoomError(
        400,
        "그림의 선이 너무 길거나 짧습니다. 다시 그려 주세요.",
      );
    }
    pointCount += stroke.points.length;
    if (pointCount > 8000)
      throw new RoomError(
        413,
        "그림이 너무 복잡합니다. 선을 조금 줄여 주세요.",
      );
    if (
      typeof stroke.color !== "string" ||
      !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(stroke.color)
    ) {
      throw new RoomError(400, "올바른 펜 색상을 선택해 주세요.");
    }
    return {
      color: stroke.color,
      points: stroke.points.map((value) => {
        const point = object(value);
        if (
          typeof point.x !== "number" ||
          typeof point.y !== "number" ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.x > 1000 ||
          point.y < 0 ||
          point.y > 440
        ) {
          throw new RoomError(400, "그림은 캔버스 안에 그려 주세요.");
        }
        return {
          x: Math.round(point.x * 100) / 100,
          y: Math.round(point.y * 100) / 100,
        };
      }),
    };
  });
  const result = { name: name(animal.name, "나의 동물", 24), strokes };
  const stats = analyzeAnimal(strokes);
  if (!stats.valid)
    throw new RoomError(
      400,
      stats.reason || "몸통과 다리가 보이도록 동물을 그려 주세요.",
    );
  return result;
}

export function normalizeRoomCode(value: unknown): string {
  if (typeof value !== "string")
    throw new RoomError(400, "6자리 방 코드를 입력해 주세요.");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code))
    throw new RoomError(400, "6자리 방 코드를 입력해 주세요.");
  return code;
}

export function secret(bytes = 24): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function hashToken(token: string): Promise<string> {
  if (!/^[a-f0-9]{48}$/.test(token))
    throw new RoomError(
      401,
      "참가 정보가 만료되었습니다. 방에 다시 입장해 주세요.",
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function inputObject(value: unknown): Record<string, unknown> {
  return object(value);
}
export function roomCapacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < ROOM_MIN_CAPACITY || value > ROOM_MAX_CAPACITY)
    throw new RoomError(400, "방 정원은 2~8명으로 설정해 주세요.");
  return value;
}
export function playerName(value: unknown): string {
  return name(value);
}
export function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (byte) => alphabet[byte % alphabet.length],
  ).join("");
}
