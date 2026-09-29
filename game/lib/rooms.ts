import type { Animal, Participant, TrackId } from './game';

export const ROOM_COLORS = ['#16915b', '#3474e6', '#1195a3', '#22352b', '#7055b4', '#c78a25', '#b74d78', '#568b32'] as const;
export const ROOM_DEFAULT_CAPACITY = 4;
export const ROOM_MIN_CAPACITY = 2;
export const ROOM_MAX_CAPACITY = 8;
export const ROOM_COUNTDOWN_MS = 4000;

export type RoomPlayer = {
  id: string;
  name: string;
  color: string;
  animal: Animal | null;
  ready: boolean;
  connected: boolean;
};

export type RoomResult = {
  playerId: string;
  finishTimeMs: number;
  rank: number;
  collisions: number;
  jumps: number;
};

export type RoomRace = {
  trackId: TrackId;
  seed: string;
  /** Server Unix time; includes the four-second countdown after starting. */
  startedAt: number;
  durationMs: number;
  /** Immutable snapshot: use this roster even if a player leaves. */
  players: Participant[];
  results: RoomResult[];
};

export type Room = {
  capacity: number;
  trackId: TrackId;
  code: string;
  hostId: string;
  phase: 'lobby' | 'racing' | 'finished';
  players: RoomPlayer[];
  race: RoomRace | null;
  expiresAt: number;
};

export type RoomResponse = { room: Room; serverNow: number; revision: number };
/** Persist this locally to rejoin after a refresh. Tokens are never public. */
export type RoomSession = RoomResponse & { playerId: string; token: string };
export type RoomAction =
  | { action: 'capacity'; capacity: number }
  | { action:'track'; trackId:TrackId }
  | { action: 'animal'; animal: Animal }
  | { action: 'ready'; ready: boolean }
  | { action: 'start' }
  | { action: 'rematch' }
  | { action: 'leave' };

export type RoomErrorResponse = { error: string };
