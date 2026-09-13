import type { Animal, Participant, TrackId } from './game';

export const ROOM_COLORS = ['#e9585e', '#4381dc', '#e6b43d', '#7b64c4'] as const;
export const ROOM_CAPACITY = 4;
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
  | { action:'track'; trackId:TrackId }
  | { action: 'animal'; animal: Animal }
  | { action: 'ready'; ready: boolean }
  | { action: 'start' }
  | { action: 'rematch' }
  | { action: 'leave' };

export type RoomErrorResponse = { error: string };
