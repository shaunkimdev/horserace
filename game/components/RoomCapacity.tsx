import { ROOM_MIN_CAPACITY, ROOM_MAX_CAPACITY } from "../lib/rooms";

export default function RoomCapacity({ value, onChange, occupied = 1, disabled = false, hostOnly = false }: {
  value: number;
  onChange: (value: number) => void;
  occupied?: number;
  disabled?: boolean;
  hostOnly?: boolean;
}) {
  return (
    <div className="room-capacity">
      <div><b>방 정원</b><span>{hostOnly ? "방장만 변경할 수 있어요." : "2~8명 · 모두 준비하면 출발"}</span></div>
      <div className="capacity-stepper" role="group" aria-label="방 정원 설정">
        <button type="button" aria-label="방 정원 줄이기" disabled={disabled || value <= Math.max(ROOM_MIN_CAPACITY, occupied)} onClick={() => onChange(value - 1)}>−</button>
        <output aria-live="polite" aria-label="방 정원">{value}<small>명</small></output>
        <button type="button" aria-label="방 정원 늘리기" disabled={disabled || value >= ROOM_MAX_CAPACITY} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}
