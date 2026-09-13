import { getRoomDatabase } from '../db';
import { MAX_ROOM_BODY_BYTES, RoomError, RoomStore } from './room-store';

export const roomStore = () => new RoomStore(getRoomDatabase());

export function roomToken(request: Request, optional = false): string | undefined {
  const authorization = request.headers.get('authorization');
  if (!authorization && optional) return undefined;
  const match = authorization?.match(/^Bearer ([a-f0-9]{48})$/);
  if (!match) throw new RoomError(401, '참가 정보를 확인할 수 없습니다. 방에 다시 입장해 주세요.');
  return match[1];
}

export async function readRoomBody(request: Request): Promise<unknown> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new RoomError(403, '이 사이트에서 다시 요청해 주세요.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RoomError(415, 'JSON 형식으로 요청해 주세요.');
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_ROOM_BODY_BYTES) throw new RoomError(413, '그림이 너무 복잡합니다. 선을 조금 줄여 주세요.');
  if (!request.body) throw new RoomError(400, '요청 내용이 비어 있습니다.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ROOM_BODY_BYTES) {
      await reader.cancel();
      throw new RoomError(413, '그림이 너무 복잡합니다. 선을 조금 줄여 주세요.');
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(data)); }
  catch { throw new RoomError(400, '요청 내용을 읽을 수 없습니다. 다시 시도해 주세요.'); }
}

export async function roomResponse(operation: () => Promise<unknown>, successStatus = 200): Promise<Response> {
  try {
    return Response.json(await operation(), { status: successStatus, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (!(error instanceof RoomError)) console.error('Room API failed', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: error instanceof RoomError ? error.message : '레이스 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' }, {
      status: error instanceof RoomError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
