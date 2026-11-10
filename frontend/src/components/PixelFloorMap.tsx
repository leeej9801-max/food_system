import { AppLink as Link } from "./AppLink";
import type { AgeBandType, StoreTable } from "../types";

interface PixelFloorMapProps {
  tables: StoreTable[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
  editLayoutMode: boolean;
  onToggleEditLayout: () => void;
  onMoveTable: (tableId: string, gridX: number, gridY: number) => void;
  isMovingTable: boolean;
  activeTableCount: number;
  activeGuestCount: number;
}

interface AvatarAppearance {
  ageLabel: string | null;
  hairColor: string;
  shirtColor: string;
  skinColor: string;
  hairStyle: "long" | "short" | "bob" | "parted";
}

const AVATAR_STYLES: Array<Omit<AvatarAppearance, "ageLabel">> = [
  {
    hairColor: "#1f242d",
    shirtColor: "#3b6ea5",
    skinColor: "#ffe0c2",
    hairStyle: "long",
  },
  {
    hairColor: "#6e472b",
    shirtColor: "#78866b",
    skinColor: "#ffdfc4",
    hairStyle: "short",
  },
  {
    hairColor: "#8c4a27",
    shirtColor: "#529471",
    skinColor: "#fde2c4",
    hairStyle: "bob",
  },
  {
    hairColor: "#5c3a28",
    shirtColor: "#d98a9c",
    skinColor: "#ffe0c2",
    hairStyle: "bob",
  },
  {
    hairColor: "#282c34",
    shirtColor: "#4a6fa5",
    skinColor: "#ffdfc4",
    hairStyle: "parted",
  },
  {
    hairColor: "#b58952",
    shirtColor: "#4b5563",
    skinColor: "#fde2c4",
    hairStyle: "long",
  },
  {
    hairColor: "#4a2e1b",
    shirtColor: "#b45309",
    skinColor: "#ffe0c2",
    hairStyle: "short",
  },
  {
    hairColor: "#374151",
    shirtColor: "#7c3aed",
    skinColor: "#fde2c4",
    hairStyle: "parted",
  },
];

function extractIndividualAgeLabels(
  partySize: number,
  ageBand: AgeBandType,
  notes: string | null
): Array<string | null> {
  const result: Array<string | null> = [];
  if (notes) {
    const match = notes.match(/^\[연령:\s*([^\]]+)\]/);
    if (match) {
      for (const token of match[1].split(",")) {
        const m = token
          .trim()
          .match(/^(10대|20대|30대|40대|50대|60대\+)\((\d+)\)$/);
        if (m) {
          const label = m[1];
          const count = Number(m[2]);
          for (let i = 0; i < count; i += 1) {
            result.push(label);
          }
        }
      }
    }
  }

  const singleMap: Partial<Record<AgeBandType, string>> = {
    "10S": "10대",
    "20S": "20대",
    "30S": "30대",
    "40S": "40대",
    "50S": "50대",
    "50S_PLUS": "50대+",
    "60S_PLUS": "60대+",
  };
  const fallbackLabel = singleMap[ageBand] ?? null;

  while (result.length < partySize) {
    result.push(fallbackLabel);
  }
  return result.slice(0, partySize);
}

/**
 * 레퍼런스 이미지 스타일의 측면/반측면 착석 도트 캐릭터 & 나무 의자
 */
function BistroSideSeat({
  side,
  occupied,
  avatar,
}: {
  side: "left" | "right";
  occupied: boolean;
  avatar?: AvatarAppearance;
}) {
  if (!occupied || !avatar) {
    // 빈 원목 의자 (측면)
    return (
      <div
        className={`relative flex h-9 w-5 flex-col justify-between rounded-xs border-2 border-[#23140b] bg-[#8f5b34] shadow-[0_2px_0_#1a0f08] ${
          side === "left" ? "-mr-1" : "-ml-1"
        }`}
      >
        <div
          className={`h-full w-1.5 bg-[#693f20] ${
            side === "left" ? "self-start" : "self-end"
          }`}
        />
      </div>
    );
  }

  const isLeft = side === "left";

  return (
    <div
      className={`relative z-20 flex flex-col items-center ${
        isLeft ? "-mr-2" : "-ml-2"
      }`}
    >
      {avatar.ageLabel && (
        <span className="-mb-1 z-30 rounded border border-[#23140b] bg-[#fffbeb] px-1 text-[8px] font-black leading-tight text-[#23140b] shadow-2xs">
          {avatar.ageLabel}
        </span>
      )}
      <svg
        width="38"
        height="42"
        viewBox="0 0 38 42"
        className="overflow-visible drop-shadow-[0_2px_0_rgba(24,13,6,0.6)]"
      >
        {/* 나무 의자 등받이 & 다리 */}
        <rect
          x={isLeft ? "3" : "29"}
          y="16"
          width="6"
          height="21"
          rx="1.5"
          fill="#6e4222"
          stroke="#23140b"
          strokeWidth="1.8"
        />
        <rect
          x="7"
          y="28"
          width="24"
          height="6"
          rx="1.5"
          fill="#8c5832"
          stroke="#23140b"
          strokeWidth="1.8"
        />
        <rect x="9" y="34" width="3.5" height="6" fill="#23140b" />
        <rect x="25" y="34" width="3.5" height="6" fill="#23140b" />

        {/* 캐릭터 몸통(상의) */}
        <rect
          x="10"
          y="19"
          width="18"
          height="12"
          rx="3"
          fill={avatar.shirtColor}
          stroke="#23140b"
          strokeWidth="1.8"
        />
        {/* 팔 (식탁 쪽으로 뻗은 손) */}
        <rect
          x={isLeft ? "20" : "10"}
          y="22"
          width="8"
          height="5"
          rx="2"
          fill={avatar.shirtColor}
          stroke="#23140b"
          strokeWidth="1.5"
        />
        <circle
          cx={isLeft ? "29" : "9"}
          cy="24.5"
          r="2.2"
          fill={avatar.skinColor}
          stroke="#23140b"
          strokeWidth="1.2"
        />

        {/* 캐릭터 머리 */}
        <rect
          x="8"
          y="4"
          width="22"
          height="17"
          rx="5"
          fill={avatar.skinColor}
          stroke="#23140b"
          strokeWidth="1.8"
        />

        {/* 헤어스타일 */}
        {avatar.hairStyle === "long" ? (
          <path
            d={
              isLeft
                ? "M7 10 C7 2, 31 2, 31 9 L31 12 L25 9 L16 10 L14 23 L7 22 Z"
                : "M7 9 C7 2, 31 2, 31 10 L31 22 L24 23 L22 10 L13 9 L7 12 Z"
            }
            fill={avatar.hairColor}
            stroke="#23140b"
            strokeWidth="1.8"
          />
        ) : avatar.hairStyle === "bob" ? (
          <path
            d="M7 10 C7 2, 31 2, 31 10 L31 19 L26 19 L25 10 L13 10 L12 19 L7 19 Z"
            fill={avatar.hairColor}
            stroke="#23140b"
            strokeWidth="1.8"
          />
        ) : (
          <path
            d="M7 10 C7 3, 31 3, 31 10 L31 13 L25 9 L19 11 L13 9 L7 13 Z"
            fill={avatar.hairColor}
            stroke="#23140b"
            strokeWidth="1.8"
          />
        )}

        {/* 눈 & 볼터치 (식탁 중앙을 바라보는 방향) */}
        <rect
          x={isLeft ? "17" : "11"}
          y="12"
          width="2.6"
          height="3.2"
          rx="1"
          fill="#1e140c"
        />
        <rect
          x={isLeft ? "24" : "18"}
          y="12"
          width="2.6"
          height="3.2"
          rx="1"
          fill="#1e140c"
        />
        <rect
          x={isLeft ? "15" : "20"}
          y="15"
          width="2.8"
          height="1.5"
          rx="0.7"
          fill="#f472b6"
          opacity="0.75"
        />
      </svg>
    </div>
  );
}

/**
 * 상/하단 보조 의자 & 추가 인원(5~8인) 착석 캐릭터
 */
function BistroTopBottomSeat({
  position,
  occupied,
  avatar,
}: {
  position: "top" | "bottom";
  occupied: boolean;
  avatar?: AvatarAppearance;
}) {
  if (!occupied || !avatar) {
    return (
      <div
        className={`h-3.5 w-8 rounded-xs border-2 border-[#23140b] bg-[#8f5b34] shadow-[0_2px_0_#1a0f08] ${
          position === "top" ? "-mb-1" : "-mt-1"
        }`}
      >
        <div className="h-1 w-full bg-[#b57c4a]" />
      </div>
    );
  }

  return (
    <div
      className={`relative z-20 flex flex-col items-center ${
        position === "top" ? "-mb-2.5" : "-mt-2"
      }`}
    >
      <svg
        width="32"
        height="30"
        viewBox="0 0 32 30"
        className="overflow-visible drop-shadow-[0_2px_0_rgba(24,13,6,0.6)]"
      >
        <rect
          x="7"
          y="16"
          width="18"
          height="10"
          rx="3"
          fill={avatar.shirtColor}
          stroke="#23140b"
          strokeWidth="1.8"
        />
        <rect
          x="6"
          y="3"
          width="20"
          height="15"
          rx="4"
          fill={avatar.skinColor}
          stroke="#23140b"
          strokeWidth="1.8"
        />
        <path
          d="M5 9 C5 2, 27 2, 27 9 L27 12 L22 9 L16 10 L10 9 L5 12 Z"
          fill={avatar.hairColor}
          stroke="#23140b"
          strokeWidth="1.8"
        />
        <rect x="11" y="11" width="2.4" height="2.8" rx="1" fill="#1e140c" />
        <rect x="18.5" y="11" width="2.4" height="2.8" rx="1" fill="#1e140c" />
      </svg>
    </div>
  );
}

/**
 * 테이블을 그리드 좌표 (col, row)에 매핑하는 헬퍼
 */
function buildFloorSlotMap(
  tables: StoreTable[],
  cols: number,
  rows: number
): Map<string, { col: number; row: number }> {
  const occupied = new Set<string>();
  const mapping = new Map<string, { col: number; row: number }>();

  const allEvenLegacy =
    tables.length > 0 &&
    tables.every((t) => t.grid_x % 2 === 0 && t.grid_y % 2 === 0) &&
    tables.some((t) => t.grid_x >= cols || t.grid_y >= rows);

  for (const t of tables) {
    const rawX = allEvenLegacy ? Math.floor(t.grid_x / 2) : t.grid_x;
    const rawY = allEvenLegacy ? Math.floor(t.grid_y / 2) : t.grid_y;
    const clampedX = Math.max(0, Math.min(cols - 1, rawX));
    const clampedY = Math.max(0, Math.min(rows - 1, rawY));
    const key = `${clampedX},${clampedY}`;

    if (!occupied.has(key)) {
      occupied.add(key);
      mapping.set(t.id, { col: clampedX, row: clampedY });
    } else {
      let placed = false;
      for (let r = 0; r < rows && !placed; r += 1) {
        for (let c = 0; c < cols && !placed; c += 1) {
          const candidate = `${c},${r}`;
          if (!occupied.has(candidate)) {
            occupied.add(candidate);
            mapping.set(t.id, { col: c, row: r });
            placed = true;
          }
        }
      }
    }
  }
  return mapping;
}

export function PixelFloorMap({
  tables,
  selectedTableId,
  onSelectTable,
  editLayoutMode,
  onToggleEditLayout,
  onMoveTable,
  isMovingTable,
  activeTableCount,
  activeGuestCount,
}: PixelFloorMapProps) {
  const cols = tables.length > 9 ? 4 : 3;
  const rows = Math.max(2, Math.ceil(Math.max(tables.length, 6) / cols));

  const slotMap = buildFloorSlotMap(tables, cols, rows);
  const tableByCell = new Map<string, StoreTable>();
  for (const t of tables) {
    const pos = slotMap.get(t.id);
    if (pos) {
      tableByCell.set(`${pos.col},${pos.row}`, t);
    }
  }

  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null;

  return (
    <section data-ui className="relative flex min-h-[calc(var(--app-viewport-height)-120px)] flex-col justify-between overflow-hidden rounded-2xl border-4 border-[#1e110a] bg-[#8b5a36] shadow-[0_8px_0_#1e110a]">
      {/* =================================================================== */}
      {/* 1. 상단 벽면: 입구(좌) · 와인랙 & BISTRO 보드(중좌) · 벽돌 화덕 & 셰프 & 바 카운터(우) */}
      {/* =================================================================== */}
      <div
        className="relative border-b-4 border-[#1e110a] bg-[#5c301c] px-3 pt-2.5 pb-3"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(30,17,10,0.28) 0px, rgba(30,17,10,0.28) 2px, transparent 2px, transparent 14px), repeating-linear-gradient(90deg, rgba(30,17,10,0.18) 0px, rgba(30,17,10,0.18) 2px, transparent 2px, transparent 28px)",
        }}
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[180px_210px_1fr]">
          {/* [좌측] 올리브그린 레스토랑 출입문 & WELCOME 매트 & 입간판 */}
          <div className="flex items-end justify-between rounded-xl border-2 border-[#1e110a] bg-[#3d2113]/90 p-2.5 shadow-[0_3px_0_#1e110a]">
            {/* 도트 화분 SVG */}
            <svg width="20" height="30" viewBox="0 0 20 30">
              <circle cx="10" cy="9" r="5" fill="#15803d" stroke="#1e110a" strokeWidth="1.5" />
              <circle cx="6" cy="13" r="4" fill="#16a34a" stroke="#1e110a" strokeWidth="1.5" />
              <circle cx="14" cy="13" r="4" fill="#16a34a" stroke="#1e110a" strokeWidth="1.5" />
              <rect
                x="5"
                y="17"
                width="10"
                height="10"
                rx="1"
                fill="#9c522b"
                stroke="#1e110a"
                strokeWidth="1.6"
              />
            </svg>

            {/* 올리브그린 양개 도어 + WELCOME 매트 */}
            <div className="flex flex-col items-center">
              <div className="flex h-16 w-20 overflow-hidden rounded-t-md border-2 border-[#1e110a] bg-[#3f5238] p-1 gap-1 shadow-inner">
                <div className="flex-1 rounded-xs border border-[#23301e] bg-[#647d59]/60">
                  <div className="m-1 h-6 rounded-2xs bg-[#fef08a]/35" />
                </div>
                <div className="flex-1 rounded-xs border border-[#23301e] bg-[#647d59]/60">
                  <div className="m-1 h-6 rounded-2xs bg-[#fef08a]/35" />
                </div>
              </div>
              <div className="mt-0.5 rounded-xs border border-[#1e110a] bg-[#6b4426] px-2.5 py-0.5 text-[9px] font-black tracking-wider text-amber-200">
                WELCOME
              </div>
            </div>

            {/* Good Food Good Wine 입간판 */}
            <div className="rounded border-2 border-[#78472a] bg-[#1e1916] px-2 py-1 text-center leading-tight text-amber-100 shadow-[0_2px_0_#1e110a]">
              <div className="text-[8px] font-black text-amber-300">Good</div>
              <div className="text-[8px] font-black">Food</div>
              <div className="text-[8px] font-black text-rose-300">Wine</div>
            </div>
          </div>

          {/* [중좌] 우드 와인 셀러 & BISTRO 흑판 메뉴 보드 */}
          <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-[#1e110a] bg-[#442414]/95 p-2.5 shadow-[0_3px_0_#1e110a]">
            {/* 와인 진열장 (와인병 도트 표현) */}
            <div className="flex-1 rounded border-2 border-[#231209] bg-[#2e170b] p-1.5">
              <div className="text-[9px] font-black text-amber-300/90">
                WINE CELLAR
              </div>
              <div className="mt-1 flex justify-around border-b border-[#5c341d] pb-1">
                {["#dc2626", "#16a34a", "#f59e0b", "#ef4444", "#10b981", "#dc2626"].map(
                  (c, idx) => (
                    <span
                      key={idx}
                      className="inline-block h-3.5 w-1.5 rounded-t-xs border border-black/50"
                      style={{ backgroundColor: c }}
                    />
                  )
                )}
              </div>
              <div className="mt-1 flex justify-around">
                {["#10b981", "#dc2626", "#ef4444", "#f59e0b", "#16a34a", "#dc2626"].map(
                  (c, idx) => (
                    <span
                      key={idx}
                      className="inline-block h-3.5 w-1.5 rounded-t-xs border border-black/50"
                      style={{ backgroundColor: c }}
                    />
                  )
                )}
              </div>
            </div>

            {/* BISTRO 흑판 */}
            <div className="flex h-full flex-col justify-between rounded border-2 border-[#78472a] bg-[#1e1b18] px-2.5 py-1.5 text-left text-amber-50 shadow-[0_2px_0_#1e110a]">
              <div className="border-b border-amber-500/40 pb-0.5 text-[10px] font-black tracking-wider text-amber-300">
                BISTRO
              </div>
              <div className="space-y-0.2 text-[9px] font-bold leading-tight text-stone-200">
                <div>Steak</div>
                <div>Pasta</div>
                <div>Wine</div>
              </div>
            </div>
          </div>

          {/* [우측] 벽돌 화덕(불꽃) + 도트 셰프 + 서빙 바 카운터 + 배치이동 컨트롤 */}
          <div className="flex flex-col justify-between rounded-xl border-2 border-[#1e110a] bg-[#4a2615]/95 p-2.5 shadow-[0_3px_0_#1e110a]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* 화덕 & 도트 셰프 일러스트 */}
              <div className="flex items-center gap-3">
                {/* 반원형 벽돌 화덕 SVG */}
                <svg width="68" height="44" viewBox="0 0 68 44">
                  <path
                    d="M4 42 A30 28 0 0 1 64 42 Z"
                    fill="#9a5b3e"
                    stroke="#1e110a"
                    strokeWidth="2.5"
                  />
                  <path
                    d="M14 42 A20 18 0 0 1 54 42 Z"
                    fill="#2b1108"
                    stroke="#1e110a"
                    strokeWidth="2"
                  />
                  {/* 화덕 불꽃 */}
                  <ellipse cx="34" cy="36" rx="13" ry="5" fill="#f97316" />
                  <circle cx="29" cy="32" r="4.5" fill="#fbbf24" />
                  <circle cx="38" cy="31" r="5" fill="#f59e0b" />
                  <circle cx="34" cy="29" r="3.5" fill="#fef08a" />
                </svg>

                {/* 하얀 조리모를 쓴 도트 셰프 아바타 */}
                <svg width="38" height="44" viewBox="0 0 38 44">
                  {/* 요리사 모자(Toque) */}
                  <rect
                    x="9"
                    y="2"
                    width="20"
                    height="10"
                    rx="4"
                    fill="#ffffff"
                    stroke="#1e110a"
                    strokeWidth="2"
                  />
                  {/* 얼굴 */}
                  <rect
                    x="10"
                    y="11"
                    width="18"
                    height="13"
                    rx="3"
                    fill="#ffe0c2"
                    stroke="#1e110a"
                    strokeWidth="2"
                  />
                  <rect x="14" y="16" width="2.2" height="2.6" fill="#1e110a" />
                  <rect x="22" y="16" width="2.2" height="2.6" fill="#1e110a" />
                  {/* 흰색 셰프복 & 빨간 스카프 */}
                  <rect
                    x="9"
                    y="24"
                    width="20"
                    height="14"
                    rx="3"
                    fill="#f8fafc"
                    stroke="#1e110a"
                    strokeWidth="2"
                  />
                  <polygon points="16,24 22,24 19,30" fill="#dc2626" />
                </svg>

                <div>
                  <div className="text-xs font-black text-amber-200">
                     오픈 키친 · 우드 파이어 그릴
                  </div>
                  <div className="text-[11px] font-bold text-amber-100/90">
                    홀 착석{" "}
                    <strong className="text-amber-300">
                      {activeTableCount}테이블 ({activeGuestCount}명)
                    </strong>
                  </div>
                </div>
              </div>

              {/* 우측 배치 이동 모드 버튼 & 테이블 설정 */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleEditLayout}
                  className={`rounded-lg border-2 border-[#1e110a] px-3 py-1.5 text-xs font-black shadow-[0_2px_0_#1e110a] transition active:translate-y-0.5 ${
                    editLayoutMode
                      ? "bg-amber-400 text-[#1e110a]"
                      : "bg-[#f5efe6] text-[#23140b] hover:bg-white"
                  }`}
                >
                  {editLayoutMode
                    ? "배치 이동 켜짐 (바닥 터치)"
                    : "테이블 위치 이동"}
                </button>
                <Link
                  to="/settings"
                  className="rounded-lg border-2 border-[#1e110a] bg-[#2e170b] px-2.5 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-[#3d2010]"
                >
                  + 테이블 설정
                </Link>
              </div>
            </div>

            {/* 오픈 키친 서빙 쇼케이스 & 5개 원형 바 스툴 */}
            <div className="mt-2 flex items-center justify-between rounded-lg border-2 border-[#1e110a] bg-[#784727] px-3 py-1.5 shadow-[0_3px_0_#1e110a]">
              <div className="flex items-center gap-2.5 text-xs">
                <span className="rounded bg-[#23140b] px-2 py-0.5 text-[10px] font-black text-amber-300">
                  BAR & PASS
                </span>
                {/* 도트 플레이트 3종 */}
                <span className="inline-block h-3.5 w-5 rounded-full border border-[#1e110a] bg-white p-0.5">
                  <span className="block h-full w-full rounded-full bg-emerald-600" />
                </span>
                <span className="inline-block h-3.5 w-5 rounded-full border border-[#1e110a] bg-white p-0.5">
                  <span className="block h-full w-full rounded-full bg-amber-500" />
                </span>
                <span className="inline-block h-3.5 w-5 rounded-full border border-[#1e110a] bg-white p-0.5">
                  <span className="block h-full w-full rounded-full bg-[#7c2d12]" />
                </span>
              </div>

              {/* 원형 나무 바 스툴 5개 (레퍼런스 이미지 중앙 상단 오마주) */}
              <div className="flex items-center gap-3">
                {[0, 1, 2, 3, 4].map((stoolIdx) => (
                  <span
                    key={stoolIdx}
                    className="inline-block h-4 w-4 rounded-full border-2 border-[#1e110a] bg-[#b57c4a] shadow-[0_2px_0_#1e110a]"
                    title="바 스툴"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 2. 메인 홀 바닥: 헤링본 우드 타일 + 좌측 빈티지 러그 + 정사각 원목 식탁 그리드 */}
      {/* =================================================================== */}
      <div
        className="relative flex-1 px-5 py-5"
        style={{
          backgroundColor: "#8b5a36",
          backgroundImage: `
            repeating-linear-gradient(45deg, rgba(43,23,11,0.13) 0px, rgba(43,23,11,0.13) 2px, transparent 2px, transparent 18px),
            repeating-linear-gradient(-45deg, rgba(43,23,11,0.13) 0px, rgba(43,23,11,0.13) 2px, transparent 2px, transparent 18px),
            repeating-linear-gradient(90deg, rgba(255,215,170,0.06) 0px, rgba(255,215,170,0.06) 36px, rgba(30,15,6,0.08) 36px, rgba(30,15,6,0.08) 72px)
          `,
        }}
      >
        {/* 좌측 벽면 빈티지 레드 러그 & 벽등 장식 (레퍼런스 이미지 좌측 디테일) */}
        <div className="pointer-events-none absolute top-8 bottom-12 left-1.5 hidden w-4 rounded-sm border-2 border-[#23140b] bg-[#8f2424] opacity-90 shadow-xs xl:block">
          <div className="h-full w-full border border-dashed border-amber-300/60" />
        </div>

        {/* 우측 벽면 은은한 벽등 포인트 */}
        <div className="pointer-events-none absolute top-12 right-1.5 hidden flex-col gap-24 xl:flex">
          <span className="h-3 w-3 rounded-full border border-[#23140b] bg-amber-300 shadow-[0_0_10px_#fbbf24]" />
          <span className="h-3 w-3 rounded-full border border-[#23140b] bg-amber-300 shadow-[0_0_10px_#fbbf24]" />
        </div>

        {tables.length === 0 ? (
          <div className="my-12 rounded-2xl border-3 border-[#23140b] bg-[#fdf8f0] p-10 text-center text-sm font-bold text-slate-700 shadow-[0_4px_0_#23140b]">
            등록된 홀 테이블이 없습니다.{" "}
            <Link to="/settings" className="text-blue-600 underline">
              설정 화면
            </Link>
            에서 테이블을 추가해 주세요.
          </div>
        ) : (
          <div
            className={`grid gap-5 ${
              cols === 4
                ? "grid-cols-2 sm:grid-cols-4"
                : "grid-cols-1 sm:grid-cols-3"
            }`}
          >
            {Array.from({ length: rows * cols }).map((_, cellIndex) => {
              const col = cellIndex % cols;
              const row = Math.floor(cellIndex / cols);
              const cellKey = `${col},${row}`;
              const table = tableByCell.get(cellKey);

              if (!table) {
                if (!editLayoutMode) {
                  return (
                    <div
                      key={cellKey}
                      className="hidden min-h-[210px] rounded-xl sm:block"
                    />
                  );
                }

                return (
                  <button
                    key={cellKey}
                    type="button"
                    disabled={!selectedTable || isMovingTable}
                    onClick={() => {
                      if (selectedTable) {
                        onMoveTable(selectedTable.id, col, row);
                      }
                    }}
                    className="flex min-h-[210px] flex-col items-center justify-center rounded-2xl border-3 border-dashed border-amber-200/80 bg-[#3d2113]/45 p-4 text-center transition hover:border-amber-300 hover:bg-[#3d2113]/70 active:scale-95"
                  >
                    <span className="rounded-lg border-2 border-[#1e110a] bg-amber-300 px-3 py-1 text-xs font-black text-[#1e110a] shadow-[0_2px_0_#1e110a]">
                      + 여기로 테이블 이동 ({col + 1}열, {row + 1}행)
                    </span>
                    {selectedTable && (
                      <span className="mt-1.5 text-xs font-extrabold text-amber-100">
                        [{selectedTable.name}] 배치하기
                      </span>
                    )}
                  </button>
                );
              }

              const isSelected = table.id === selectedTableId;
              const activeVisit = table.active_visit;
              const partySize = activeVisit?.party_size ?? 0;
              const isPaid = activeVisit?.status === "PAID";

              const ageLabels = activeVisit
                ? extractIndividualAgeLabels(
                    partySize,
                    activeVisit.age_band,
                    activeVisit.notes
                  )
                : [];

              const makeAvatar = (seatIndex: number): AvatarAppearance | undefined => {
                if (!activeVisit || seatIndex >= partySize) return undefined;
                const style =
                  AVATAR_STYLES[
                    (seatIndex + table.name.charCodeAt(0)) % AVATAR_STYLES.length
                  ];
                return {
                  ...style,
                  ageLabel: ageLabels[seatIndex] ?? null,
                };
              };

              // 레퍼런스 이미지처럼 좌·우 마주보는 4인 좌석(0: 좌상, 1: 우상, 2: 좌하, 3: 우하)을 우선 배치하고,
              // 5~8인일 때 상단(4, 5)·하단(6, 7) 좌석에 추가 착석
              const leftTopAvatar = makeAvatar(0);
              const rightTopAvatar = makeAvatar(1);
              const leftBottomAvatar = makeAvatar(2);
              const rightBottomAvatar = makeAvatar(3);
              const topLeftAvatar = makeAvatar(4);
              const topRightAvatar = makeAvatar(5);
              const bottomLeftAvatar = makeAvatar(6);
              const bottomRightAvatar = makeAvatar(7);

              return (
                <div
                  key={table.id}
                  onClick={() => onSelectTable(table.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectTable(table.id);
                    }
                  }}
                  className={`group relative flex min-h-[215px] cursor-pointer flex-col items-center justify-end rounded-2xl p-2 transition select-none active:scale-[0.98] ${
                    isSelected
                      ? "bg-amber-100/25 ring-4 ring-amber-300"
                      : "hover:bg-black/10"
                  }`}
                >
                  {/* ======================================================= */}
                  {/* 레퍼런스 스타일 상단 픽셀 말풍선 (착석중: 흰색 / 결제완료: 골드) */}
                  {/* ======================================================= */}
                  {activeVisit ? (
                    <div
                      className={`relative z-30 mb-1.5 rounded-xl border-2 border-[#23140b] px-3 py-1 text-center shadow-[0_3px_0_#23140b] ${
                        isPaid
                          ? "bg-[#fbbf24] text-[#23140b]"
                          : "bg-white text-[#23140b]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-black">
                        {isPaid ? (
                          <>
                            <span className="inline-block h-3 w-3 rounded-full border border-[#23140b] bg-amber-300" />
                            <span>
                              {table.name} · 결제완료 ({partySize}명)
                            </span>
                          </>
                        ) : (
                          <span>
                            {table.name} · {partySize}명 식사중
                          </span>
                        )}
                      </div>
                      <div
                        className={`mx-auto -mb-2 mt-0.5 h-2 w-2 rotate-45 border-r-2 border-b-2 border-[#23140b] ${
                          isPaid ? "bg-[#fbbf24]" : "bg-white"
                        }`}
                      />
                    </div>
                  ) : (
                    <div
                      className={`mb-1.5 rounded-lg border border-[#23140b]/70 px-2.5 py-0.5 text-[11px] font-extrabold ${
                        isSelected
                          ? "bg-amber-300 text-[#1e110a] shadow-[0_2px_0_#1e110a]"
                          : "bg-[#2b180c]/75 text-amber-100/90"
                      }`}
                    >
                      {table.name} · 빈 테이블 ({table.seats}인석)
                    </div>
                  )}

                  {/* ======================================================= */}
                  {/* 상단 의자 2개 + 좌우 의자/캐릭터 + 정사각 원목 식탁 + 하단 의자 2개 */}
                  {/* ======================================================= */}
                  <div className="flex flex-col items-center">
                    {/* 상단 의자 2개 */}
                    <div className="flex items-end justify-center gap-5">
                      <BistroTopBottomSeat
                        position="top"
                        occupied={Boolean(topLeftAvatar)}
                        avatar={topLeftAvatar}
                      />
                      <BistroTopBottomSeat
                        position="top"
                        occupied={Boolean(topRightAvatar)}
                        avatar={topRightAvatar}
                      />
                    </div>

                    {/* 중간 행: 좌측 의자/캐릭터 2열 + 중앙 정사각 원목 식탁 + 우측 의자/캐릭터 2열 */}
                    <div className="flex items-center justify-center">
                      {/* 좌측 의자/손님 2자리 */}
                      <div className="flex flex-col items-end justify-around gap-1.5 py-1">
                        <BistroSideSeat
                          side="left"
                          occupied={Boolean(leftTopAvatar)}
                          avatar={leftTopAvatar}
                        />
                        {table.seats >= 4 || partySize >= 3 ? (
                          <BistroSideSeat
                            side="left"
                            occupied={Boolean(leftBottomAvatar)}
                            avatar={leftBottomAvatar}
                          />
                        ) : null}
                      </div>

                      {/* 중앙 정사각형 원목 비스트로 식탁 (레퍼런스 이미지 1:1 재현) */}
                      <div
                        className={`relative z-10 flex h-[112px] w-[124px] flex-col items-center justify-between rounded-md border-[3px] border-[#23140b] p-2 shadow-[0_6px_0_#1a0f08] transition ${
                          isSelected
                            ? "bg-[#c88a55]"
                            : activeVisit
                            ? "bg-[#bd7e48]"
                            : "bg-[#b0723e]"
                        }`}
                      >
                        {/* 식탁 안쪽 나무 프레임 선 */}
                        <div className="pointer-events-none absolute inset-1.5 rounded-xs border border-[#784722]/70" />

                        {!activeVisit ? (
                          /* 빈 식탁: 중앙 작은 화병(꽃병) + 하단 검은 [T1] 명판 */
                          <>
                            <div className="h-2" />
                            <div className="relative z-10 flex flex-col items-center">
                              {/* 흰색 코스터 & 미니 꽃병 SVG */}
                              <svg width="28" height="32" viewBox="0 0 28 32">
                                <ellipse
                                  cx="14"
                                  cy="27"
                                  rx="8"
                                  ry="3"
                                  fill="#fef3c7"
                                  stroke="#23140b"
                                  strokeWidth="1.2"
                                />
                                {/* 꽃잎 */}
                                <circle cx="11" cy="10" r="3.5" fill="#fb7185" />
                                <circle cx="17" cy="10" r="3.5" fill="#fde047" />
                                <circle cx="14" cy="7" r="3.5" fill="#f97316" />
                                <rect x="13" y="11" width="2" height="6" fill="#15803d" />
                                {/* 도자기 화병 */}
                                <path
                                  d="M10 16 L18 16 L19 26 L9 26 Z"
                                  fill="#f8fafc"
                                  stroke="#23140b"
                                  strokeWidth="1.6"
                                />
                              </svg>
                            </div>
                          </>
                        ) : (
                          /* 착석 식탁: 스테이크·파스타 접시 + 레드와인잔 + 중앙 캔들 + (결제완료 시 계산서/코인) */
                          <div className="relative z-10 grid h-full w-full grid-cols-3 items-center justify-items-center pt-0.5 pb-4">
                            {/* 좌상: 스테이크 접시 */}
                            <svg width="28" height="24" viewBox="0 0 28 24">
                              <ellipse
                                cx="14"
                                cy="12"
                                rx="12"
                                ry="9"
                                fill="#f8fafc"
                                stroke="#23140b"
                                strokeWidth="1.6"
                              />
                              <ellipse cx="13" cy="12" rx="7" ry="4.5" fill="#7c2d12" />
                              <circle cx="19" cy="9" r="2" fill="#16a34a" />
                            </svg>

                            {/* 중앙: 따뜻한 캔들(촛불) 조명 */}
                            <div className="flex flex-col items-center">
                              <span className="h-2.5 w-2 rounded-full bg-amber-300 shadow-[0_0_8px_#fde047]" />
                              <span className="h-3.5 w-2.5 rounded-2xs border border-[#23140b] bg-[#fef9c3]" />
                            </div>

                            {/* 우상: 레드 와인잔 */}
                            <svg width="18" height="22" viewBox="0 0 18 22">
                              <path
                                d="M4 3 L14 3 L12 11 C12 13, 6 13, 6 11 Z"
                                fill="#991b1b"
                                stroke="#23140b"
                                strokeWidth="1.5"
                              />
                              <line
                                x1="9"
                                y1="12"
                                x2="9"
                                y2="18"
                                stroke="#23140b"
                                strokeWidth="1.5"
                              />
                              <ellipse cx="9" cy="18.5" rx="4" ry="1.5" fill="#23140b" />
                            </svg>

                            {/* 좌하: 레드 와인잔 */}
                            <svg width="18" height="22" viewBox="0 0 18 22">
                              <path
                                d="M4 3 L14 3 L12 11 C12 13, 6 13, 6 11 Z"
                                fill="#991b1b"
                                stroke="#23140b"
                                strokeWidth="1.5"
                              />
                              <line
                                x1="9"
                                y1="12"
                                x2="9"
                                y2="18"
                                stroke="#23140b"
                                strokeWidth="1.5"
                              />
                              <ellipse cx="9" cy="18.5" rx="4" ry="1.5" fill="#23140b" />
                            </svg>

                            <div />

                            {/* 우하: 파스타 접시 (또는 결제완료 시 영수증+동전) */}
                            {isPaid ? (
                              <svg width="26" height="24" viewBox="0 0 26 24">
                                <rect
                                  x="3"
                                  y="2"
                                  width="13"
                                  height="17"
                                  rx="1.5"
                                  fill="#ffffff"
                                  stroke="#23140b"
                                  strokeWidth="1.6"
                                />
                                <line
                                  x1="6"
                                  y1="6"
                                  x2="13"
                                  y2="6"
                                  stroke="#64748b"
                                  strokeWidth="1.5"
                                />
                                <line
                                  x1="6"
                                  y1="10"
                                  x2="13"
                                  y2="10"
                                  stroke="#64748b"
                                  strokeWidth="1.5"
                                />
                                <circle
                                  cx="19"
                                  cy="16"
                                  r="4.5"
                                  fill="#fbbf24"
                                  stroke="#23140b"
                                  strokeWidth="1.5"
                                />
                              </svg>
                            ) : (
                              <svg width="28" height="24" viewBox="0 0 28 24">
                                <ellipse
                                  cx="14"
                                  cy="12"
                                  rx="12"
                                  ry="9"
                                  fill="#f8fafc"
                                  stroke="#23140b"
                                  strokeWidth="1.6"
                                />
                                <ellipse cx="14" cy="12" rx="7.5" ry="5" fill="#f59e0b" />
                                <circle cx="14" cy="11" r="2" fill="#dc2626" />
                              </svg>
                            )}
                          </div>
                        )}

                        {/* 레퍼런스 이미지의 식탁 하단 중앙 블랙 테이블 번호판 [T1] */}
                        <div className="relative z-20 -mb-0.5 rounded-xs border border-[#120a05] bg-[#231812] px-2.5 py-0.2 text-[10px] font-black tracking-wider text-amber-50 shadow-2xs">
                          {table.name}
                        </div>
                      </div>

                      {/* 우측 의자/손님 2자리 */}
                      <div className="flex flex-col items-start justify-around gap-1.5 py-1">
                        <BistroSideSeat
                          side="right"
                          occupied={Boolean(rightTopAvatar)}
                          avatar={rightTopAvatar}
                        />
                        {table.seats >= 4 || partySize >= 4 ? (
                          <BistroSideSeat
                            side="right"
                            occupied={Boolean(rightBottomAvatar)}
                            avatar={rightBottomAvatar}
                          />
                        ) : null}
                      </div>
                    </div>

                    {/* 하단 의자 2개 */}
                    <div className="flex items-start justify-center gap-5">
                      <BistroTopBottomSeat
                        position="bottom"
                        occupied={Boolean(bottomLeftAvatar)}
                        avatar={bottomLeftAvatar}
                      />
                      <BistroTopBottomSeat
                        position="bottom"
                        occupied={Boolean(bottomRightAvatar)}
                        avatar={bottomRightAvatar}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* 3. 하단 벽면 & 화분 장식 바 (레퍼런스 이미지 하단 테두리 재현) */}
      {/* =================================================================== */}
      <div className="flex items-center justify-between border-t-4 border-[#1e110a] bg-[#361d10] px-4 py-2 text-xs font-extrabold text-amber-100">
        <div className="flex items-center gap-2">
          <span>BISTRO HALL FLOOR</span>
        </div>
        <div className="rounded border border-amber-500/40 bg-[#522914] px-3 py-0.5 text-[11px] font-black text-amber-200">
          {selectedTable
            ? `현재 선택: ${selectedTable.name} (${selectedTable.seats}인석)`
            : "테이블을 터치하세요"}
        </div>
        <div className="flex items-center gap-2">
          <span>양식 비스트로 홀</span>
        </div>
      </div>
    </section>
  );
}
