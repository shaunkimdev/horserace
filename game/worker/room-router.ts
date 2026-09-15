import { readRoomBody, roomResponse } from "../lib/room-api";
import {
  inputObject,
  newRoomCode,
  normalizeRoomCode,
  RoomError,
} from "../lib/room-validation";

export interface RoomEnv {
  RACE_ROOMS: DurableObjectNamespace;
}

/** Preserve the site's origin and credentials while routing every room to one object. */
export async function routeRoomRequest(
  request: Request,
  env: RoomEnv,
): Promise<Response> {
  try {
    if (!env.RACE_ROOMS)
      throw new RoomError(503, "게임 서버 연결 설정이 필요합니다.");
    const url = new URL(request.url);
    const forward = (code: string, path: string, body?: unknown) => {
      const target = new URL(request.url);
      target.pathname = path;
      target.search = "";
      if (path === "/create") target.searchParams.set("code", code);
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      const next = new Request(target, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return env.RACE_ROOMS.get(env.RACE_ROOMS.idFromName(code)).fetch(next);
    };
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await readRoomBody(request);
      for (let attempt = 0; attempt < 12; attempt++) {
        const response = await forward(newRoomCode(), "/create", body);
        if (response.status !== 409) return response;
      }
      throw new RoomError(503, "방을 만들지 못했습니다. 다시 시도해 주세요.");
    }
    if (url.pathname === "/api/rooms/join" && request.method === "POST") {
      const body = inputObject(await readRoomBody(request));
      return forward(normalizeRoomCode(body.code), "/join", body);
    }
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/socket)?$/);
    if (!match) throw new RoomError(404, "알 수 없는 요청입니다.");
    const code = normalizeRoomCode(match[1]);
    if (match[2] && request.method === "GET") return forward(code, "/socket");
    if (!match[2] && request.method === "GET")
      return forward(code, "/snapshot");
    if (!match[2] && request.method === "POST")
      return forward(code, "/action", await readRoomBody(request));
    throw new RoomError(405, "지원하지 않는 요청입니다.");
  } catch (error) {
    return roomResponse(() => {
      throw error;
    });
  }
}
