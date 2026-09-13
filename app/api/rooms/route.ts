import { readRoomBody, roomResponse, roomStore } from '../../../lib/room-api';

export async function POST(request: Request) {
  return roomResponse(async () => roomStore().create(await readRoomBody(request)), 201);
}
