import { env } from "cloudflare:workers";
import { routeRoomRequest } from "../../../../worker/room-router";

export const POST = (request: Request) => routeRoomRequest(request, env);
export const GET = (request: Request) => routeRoomRequest(request, env);
