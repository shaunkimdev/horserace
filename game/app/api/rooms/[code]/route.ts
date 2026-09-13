import { readRoomBody, roomResponse, roomStore, roomToken } from '../../../../lib/room-api';

type Context = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: Context) {
  return roomResponse(async () => roomStore().get((await context.params).code, roomToken(request)!));
}

export async function POST(request: Request, context: Context) {
  return roomResponse(async () => roomStore().act((await context.params).code, roomToken(request)!, await readRoomBody(request)));
}
