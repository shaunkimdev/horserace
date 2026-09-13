import { readRoomBody, roomResponse, roomStore, roomToken } from '../../../../lib/room-api';

export async function POST(request: Request) {
  return roomResponse(async () => roomStore().join(await readRoomBody(request), roomToken(request, true)));
}
