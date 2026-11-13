import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";

import { FLOOR_COLS, FLOOR_ROWS } from "../types";
import type { FloorFixture, StoreTable } from "../types";

// 홀 도면 (WO-20261105-001, U-31, U-47). 좌표계 28×24칸(1칸 ≈ 34cm), 카운터에서 바라본 방향.
// 도면은 칸 비율을 조금 늘려서라도 영역을 꽉 채운다(테이블 위치가 목적이라 비율보다 크기가 우선).
// 글자와 둥근 점은 되돌려 늘려 찌그러지지 않게 한다.
// H 테이블 4×2칸(의자 위·아래), V 테이블 2×4칸(의자 좌·우).
// 그림은 인테리어 평면도 선화처럼: 흰 가구 + 얇은 갈색 윤곽선 + 오른쪽 아래 그림자, 옅은 헤링본 바닥, 이중선 벽.
// 윤곽선은 non-scaling-stroke(화면 px 굵기)라 도면을 늘려도 굵기가 같다. 상태는 테이블 윗면 색으로만 보인다.

interface FloorPlanProps {
  tables: StoreTable[];
  fixtures: FloorFixture[];
  selectedTableId: string | null;
  onSelectTable: (id: string) => void;
  editMode: boolean;
  onMoveTable: (tableId: string, gridX: number, gridY: number) => void;
  pixel: boolean;
}

interface PlacedTable {
  table: StoreTable;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEGACY_MAX_X = 11;
const LEGACY_MAX_Y = 7;

/** 도면 색. 홈 화면 범례(착석·결제)도 이 값을 쓴다. */
export const FLOOR_COLORS = {
  floor: "#f7f4ef",
  floorPixel: "#ead9b8",
  tile: "#ebe4d9",
  wall: "#d6cabd",
  line: "#8c7462",
  furniture: "#fdfcfa",
  shadow: "#9c8a78",
  seated: "#7d9270",
  seatedTint: "#e4ebdc",
  paid: "#c4834a",
  paidTint: "#f5e3d2",
  plant: "#a9b79c",
  glass: "#eef3f4",
  ink: "#4f4034",
  blocked: "#f3c9c2",
  blockedEdge: "#b3412e",
} as const;
const C = FLOOR_COLORS;
const WALL = 0.42;
const PLAN_ASPECT = (FLOOR_COLS + 1) / (FLOOR_ROWS + 1);

/** 도면을 가로(sx)·세로(sy)로 늘린 배율. 글자는 이 값으로 되돌린다. */
const Stretch = createContext({ sx: 1, sy: 1 });

type Side = "top" | "bottom" | "left" | "right";

/** 고정물이 붙은 바깥 벽 쪽. 가장 가까운 경계를 고른다. */
function edgeSide(f: Box): Side {
  const d: [Side, number][] = [
    ["top", f.y],
    ["bottom", FLOOR_ROWS - (f.y + f.h)],
    ["left", f.x],
    ["right", FLOOR_COLS - (f.x + f.w)],
  ];
  return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

/** 바깥 벽 띠 위의 구간. 입구·유리창은 고정물 칸이 아니라 벽에 그린다. */
function wallBand(f: Box) {
  const side = edgeSide(f);
  const horiz = side === "top" || side === "bottom";
  const mid = side === "top" || side === "left" ? -WALL / 2 : (horiz ? FLOOR_ROWS : FLOOR_COLS) + WALL / 2;
  const start = horiz ? f.x : f.y;
  const len = horiz ? f.w : f.h;
  // 벽 띠 안에서 (구간 시작 a, 벽 중심선에서 떨어진 거리 off, 길이 l, 두께 t) 사각형
  const rect = (a: number, off: number, l: number, t: number) =>
    horiz
      ? { x: a, y: mid + off, width: l, height: t }
      : { x: mid + off, y: a, width: t, height: l };
  return { side, start, len, rect };
}

/** 도면이 없는 예전 매장(좌표 0..11×0..7)은 순서대로 격자에 펼쳐 겹치지 않게 그린다. */
export function placeTables(tables: StoreTable[], fixtures: FloorFixture[]): PlacedTable[] {
  const size = (t: StoreTable) => {
    const long = t.seats <= 2 ? 3 : 4; // 2인석은 짧게
    return t.orientation === "V" ? { w: 2, h: long } : { w: long, h: 2 };
  };
  const legacy =
    fixtures.length === 0 &&
    tables.every((t) => t.grid_x <= LEGACY_MAX_X && t.grid_y <= LEGACY_MAX_Y);
  if (!legacy) {
    return tables.map((t) => ({ table: t, x: t.grid_x, y: t.grid_y, ...size(t) }));
  }
  const sorted = [...tables].sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x);
  const cols = sorted.length > 12 ? 4 : 3;
  return sorted.map((t, i) => ({
    table: t,
    x: 1 + (i % cols) * (cols === 4 ? 6 : 8),
    y: 2 + Math.floor(i / cols) * 5,
    w: 4,
    h: 2,
  }));
}

interface Drag {
  id: string;
  grabX: number; // 테이블 왼쪽 위에서 잡은 지점까지 거리(칸)
  grabY: number;
  x: number;
  y: number;
  moved: boolean;
}

type Box = { x: number; y: number; w: number; h: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 다른 테이블이나 고정물(벽·주방 등)과 겹치지 않으면 놓을 수 있다. */
export function canPlace(placed: PlacedTable[], fixtures: FloorFixture[], target: PlacedTable): boolean {
  return (
    !placed.some((o) => o.table.id !== target.table.id && overlaps(o, target)) &&
    !fixtures.some((f) => overlaps(f, target))
  );
}

/** 포인터 위치를 도면 칸 좌표(소수)로 바꾼다. 늘린 배율(sx, sy)을 되돌린다. */
function toCell(evt: React.PointerEvent<SVGElement>, sx: number, sy: number) {
  const m = evt.currentTarget.ownerSVGElement?.getScreenCTM();
  if (!m) return null;
  const pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(m.inverse());
  return { x: pt.x / sx, y: pt.y / sy };
}

function Label({
  x,
  y,
  children,
  size = 0.6,
  weight = 600,
  fill = C.ink,
}: {
  x: number;
  y: number;
  children: string;
  size?: number;
  weight?: number;
  fill?: string;
}) {
  const { sx, sy } = useContext(Stretch);
  return (
    <text
      transform={`translate(${x} ${y}) scale(${1 / sx} ${1 / sy})`}
      fontSize={size}
      fill={fill}
      textAnchor="middle"
      dominantBaseline="central"
      fontWeight={weight}
      letterSpacing={0.08}
    >
      {children}
    </text>
  );
}

/** 가구 윤곽선. 화면 px 굵기라 늘려도 같다. */
const OUTLINE = { stroke: C.line, strokeWidth: 1, vectorEffect: "non-scaling-stroke" } as const;
const FURNITURE = { fill: C.furniture, ...OUTLINE } as const;

/** 입구 글자는 문 안쪽 바닥에 둔다. */
const ENTRANCE_LABEL: Record<Side, (f: Box) => { x: number; y: number }> = {
  top: (f) => ({ x: f.x + f.w / 2, y: f.y + f.h + 0.6 }),
  bottom: (f) => ({ x: f.x + f.w / 2, y: f.y - 0.6 }),
  left: (f) => ({ x: f.x + f.w + 0.8, y: f.y + f.h / 2 }),
  right: (f) => ({ x: f.x - 0.8, y: f.y + f.h / 2 }),
};

/** 동그란 것(화분)은 늘어나지 않게 배율을 되돌린 타원으로 그린다. */
function Dot({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const { sx, sy } = useContext(Stretch);
  return <ellipse cx={cx} cy={cy} rx={r / sx} ry={r / sy} fill={fill} {...OUTLINE} />;
}

/** 고정물: 입구는 벽의 미닫이 자동문, 창은 벽의 유리, 칸막이는 화분 줄, 소파는 벽 쪽 등받이 붙박이 의자. */
function Fixture({ f }: { f: FloorFixture }) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  switch (f.kind) {
    case "ENTRANCE": {
      const { start, len, rect } = wallBand(f);
      return (
        <g>
          <rect {...rect(start, -WALL / 2 - 0.05, len, WALL + 0.1)} fill={C.floor} />
          <rect {...rect(start + 0.1, -0.12, len * 0.55, 0.09)} {...FURNITURE} />
          <rect {...rect(start + len * 0.45 - 0.1, 0.03, len * 0.55, 0.09)} {...FURNITURE} />
          {f.label && (
            <Label {...ENTRANCE_LABEL[edgeSide(f)](f)} size={0.45} weight={500} fill={C.line}>
              {f.label}
            </Label>
          )}
        </g>
      );
    }
    case "WALL": {
      const { start, len, rect } = wallBand(f);
      return (
        <g>
          <rect {...rect(start, -WALL / 2, len, WALL)} fill={C.glass} {...OUTLINE} />
          <rect {...rect(start, -0.01, len, 0.02)} fill={C.line} opacity={0.5} />
        </g>
      );
    }
    case "PILLAR":
      return <rect x={f.x} y={f.y} width={f.w} height={f.h} fill={C.wall} {...OUTLINE} />;
    case "SOFA": {
      // 벽 쪽 등받이 + 앉는 면. 쿠션은 약 2.5칸마다 나눈다
      const side = edgeSide(f);
      const vert = f.h >= f.w;
      const len = vert ? f.h : f.w;
      const back = 0.45;
      const n = Math.max(1, Math.round(len / 2.5));
      const step = len / n;
      const bx = side === "right" ? f.x + f.w - back : f.x;
      const by = side === "bottom" ? f.y + f.h - back : f.y;
      return (
        <g>
          <rect x={f.x + 0.05} y={f.y + 0.05} width={f.w - 0.1} height={f.h - 0.1} rx={0.3} {...FURNITURE} filter="url(#fp-shadow)" />
          <rect
            x={vert ? bx + 0.05 : f.x + 0.05}
            y={vert ? f.y + 0.05 : by + 0.05}
            width={vert ? back : f.w - 0.1}
            height={vert ? f.h - 0.1 : back}
            rx={0.2}
            {...FURNITURE}
          />
          {Array.from({ length: n - 1 }, (_, i) =>
            vert ? (
              <line key={i} x1={f.x + back + 0.05} y1={f.y + step * (i + 1)} x2={f.x + f.w - 0.1} y2={f.y + step * (i + 1)} {...OUTLINE} />
            ) : (
              <line key={i} x1={f.x + step * (i + 1)} y1={f.y + back + 0.05} x2={f.x + step * (i + 1)} y2={f.y + f.h - 0.1} {...OUTLINE} />
            )
          )}
        </g>
      );
    }
    case "WAITING":
      return (
        <g>
          <rect x={f.x + 0.1} y={f.y + 0.2} width={f.w - 0.2} height={f.h - 0.4} rx={0.25} {...FURNITURE} filter="url(#fp-shadow)" />
        </g>
      );
    case "COUNTER":
      return (
        <g>
          <rect x={f.x + 0.1} y={f.y + 0.1} width={f.w - 0.2} height={f.h - 0.2} rx={0.35} {...FURNITURE} filter="url(#fp-shadow)" />
          <rect x={f.x + 0.45} y={f.y + 0.45} width={f.w - 0.9} height={f.h - 0.9} rx={0.2} fill="none" {...OUTLINE} />
          {f.label && <Label x={cx} y={cy} size={0.55} weight={500} fill={C.line}>{f.label}</Label>}
        </g>
      );
    case "KITCHEN":
      return (
        <g>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="url(#fp-hatch)" {...OUTLINE} />
          {f.label && <Label x={cx} y={cy} size={0.55} weight={500} fill={C.line}>{f.label}</Label>}
        </g>
      );
    case "PARTITION": {
      // 낮은 화분대 위에 화분을 한 칸씩
      const vertical = f.h >= f.w;
      const n = Math.max(1, Math.round(vertical ? f.h : f.w));
      return (
        <g>
          <rect x={f.x + 0.15} y={f.y + 0.15} width={f.w - 0.3} height={f.h - 0.3} rx={0.12} {...FURNITURE} filter="url(#fp-shadow)" />
          {Array.from({ length: n }, (_, i) => (
            <Dot
              key={i}
              cx={vertical ? cx : f.x + i + 0.5}
              cy={vertical ? f.y + i + 0.5 : cy}
              r={i % 2 ? 0.24 : 0.3}
              fill={C.plant}
            />
          ))}
        </g>
      );
    }
    default:
      return (
        <g>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={0.15} {...FURNITURE} />
          {f.label && <Label x={cx} y={cy} size={0.55} weight={500} fill={C.line}>{f.label}</Label>}
        </g>
      );
  }
}

export function FloorPlan({
  tables,
  fixtures,
  selectedTableId,
  onSelectTable,
  editMode,
  onMoveTable,
  pixel,
}: FloorPlanProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // 그려지는 영역 비율 / 도면 비율. 1보다 크면 가로로, 작으면 세로로 늘린다.
  const [ratio, setRatio] = useState(1);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setRatio(width / height / PLAN_ASPECT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // shortcut: 0.6~1.8배까지만 늘리고 넘는 부분은 여백. 휴대폰 세로 화면 전용 배치가 생기면 다시 본다.
  const k = Math.min(1.8, Math.max(0.6, ratio));
  const sx = k >= 1 ? k : 1;
  const sy = k >= 1 ? 1 : 1 / k;
  const placed = placeTables(tables, fixtures).map((p) =>
    drag && p.table.id === drag.id ? { ...p, x: drag.x, y: drag.y } : p
  );

  function startDrag(evt: React.PointerEvent<SVGGElement>, p: PlacedTable) {
    onSelectTable(p.table.id);
    if (!editMode) return;
    const cell = toCell(evt, sx, sy);
    if (!cell) return;
    evt.currentTarget.setPointerCapture(evt.pointerId);
    setDrag({ id: p.table.id, grabX: cell.x - p.x, grabY: cell.y - p.y, x: p.x, y: p.y, moved: false });
  }

  function moveDrag(evt: React.PointerEvent<SVGGElement>, p: PlacedTable) {
    if (!drag || drag.id !== p.table.id) return;
    const cell = toCell(evt, sx, sy);
    if (!cell) return;
    const x = Math.max(0, Math.min(FLOOR_COLS - p.w, Math.round(cell.x - drag.grabX)));
    const y = Math.max(0, Math.min(FLOOR_ROWS - p.h, Math.round(cell.y - drag.grabY)));
    if (x !== drag.x || y !== drag.y) setDrag({ ...drag, x, y, moved: true });
  }

  function endDrag(p: PlacedTable) {
    if (!drag || drag.id !== p.table.id) return;
    // 겹치는 자리에 놓으면 저장하지 않고 원래 자리로 돌아간다
    if (drag.moved && canPlace(placed, fixtures, p)) onMoveTable(p.table.id, p.x, p.y);
    setDrag(null);
  }

  const floorFill = pixel ? C.floorPixel : C.floor;
  // 소파 쪽에는 의자를 그리지 않는다
  const sofas = fixtures.filter((f) => f.kind === "SOFA");

  return (
    <svg
      ref={svgRef}
      viewBox={`${-0.5 * sx} ${-0.5 * sy} ${(FLOOR_COLS + 1) * sx} ${(FLOOR_ROWS + 1) * sy}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full select-none"
      style={editMode ? { touchAction: "none" } : undefined}
      role="img"
      aria-label="매장 홀 도면"
    >
      <defs>
        {/* 헤링본: 1×1칸 안에 V자 두 줄 */}
        <pattern id="fp-tile" width={1} height={1} patternUnits="userSpaceOnUse">
          <rect width={1} height={1} fill={floorFill} />
          {pixel ? (
            <path d="M0 0H1M0 0V1" stroke={C.tile} strokeWidth={0.03} />
          ) : (
            <path d="M0 0.5L0.5 0L1 0.5M0 1L0.5 0.5L1 1" fill="none" stroke={C.tile} strokeWidth={0.035} />
          )}
        </pattern>
        <pattern id="fp-hatch" width={0.5} height={0.5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={0.5} height={0.5} fill={C.furniture} />
          <line x1={0} y1={0} x2={0} y2={0.5} stroke={C.tile} strokeWidth={0.06} />
        </pattern>
        {/* 빛이 왼쪽 위에서 오는 그림자 */}
        <filter id="fp-shadow" x="-20%" y="-20%" width="150%" height="160%">
          <feDropShadow dx={0.22} dy={0.28} stdDeviation={0.12} floodColor={C.shadow} floodOpacity={0.35} />
        </filter>
      </defs>

      <Stretch.Provider value={{ sx, sy }}>
      <g transform={`scale(${sx} ${sy})`}>
      <rect x={0} y={0} width={FLOOR_COLS} height={FLOOR_ROWS} fill="url(#fp-tile)" data-testid="floor-surface" />
      {/* 바깥 벽. 좌표 0..FLOOR_COLS×0..FLOOR_ROWS 안쪽을 그대로 쓰도록 벽은 경계 바깥쪽에 그린다 */}
      <rect x={-WALL / 2} y={-WALL / 2} width={FLOOR_COLS + WALL} height={FLOOR_ROWS + WALL} fill="none" stroke={C.wall} strokeWidth={WALL} />
      <rect x={-WALL} y={-WALL} width={FLOOR_COLS + WALL * 2} height={FLOOR_ROWS + WALL * 2} fill="none" {...OUTLINE} />
      <rect x={0} y={0} width={FLOOR_COLS} height={FLOOR_ROWS} fill="none" {...OUTLINE} />
      {editMode &&
        Array.from({ length: FLOOR_COLS - 1 }, (_, i) => (
          <line key={`gx${i}`} x1={i + 1} y1={0} x2={i + 1} y2={FLOOR_ROWS} stroke="#d8ccb6" strokeWidth={0.03} pointerEvents="none" />
        ))}
      {editMode &&
        Array.from({ length: FLOOR_ROWS - 1 }, (_, i) => (
          <line key={`gy${i}`} x1={0} y1={i + 1} x2={FLOOR_COLS} y2={i + 1} stroke="#d8ccb6" strokeWidth={0.03} pointerEvents="none" />
        ))}

      <g pointerEvents="none">
        {fixtures.map((f, i) => (
          <Fixture key={`f${i}`} f={f} />
        ))}
      </g>

      {placed.map((p) => {
        const { table: t, x, y, w, h } = p;
        const dragging = drag?.id === t.id;
        const blocked = dragging && !canPlace(placed, fixtures, p);
        const selected = t.id === selectedTableId;
        const visit = t.active_visit;
        const accent = visit?.status === "PAID" ? C.paid : visit ? C.seated : null;
        const tint = visit?.status === "PAID" ? C.paidTint : visit ? C.seatedTint : C.furniture;
        const vertical = t.orientation === "V";
        // 의자: 좌석 + 바깥쪽 등받이. [x, y, 등받이 방향]. 2인석은 양쪽 가운데 하나씩.
        const along = t.seats <= 2 ? [(vertical ? h : w) / 2 - 0.55] : [0.6, 2.3];
        type Chair = [number, number, "up" | "down" | "left" | "right"];
        const chairs = (
          vertical
            ? along.flatMap((d): Chair[] => [
                [x - 0.85, y + d, "left"],
                [x + w + 0.15, y + d, "right"],
              ])
            : along.flatMap((d): Chair[] => [
                [x + d, y - 0.85, "up"],
                [x + d, y + h + 0.15, "down"],
              ])
        ).filter(([cx, cy]) => !sofas.some((f) => overlaps(f, { x: cx + 0.3, y: cy + 0.3, w: 0.1, h: 0.1 })));
        return (
          <g
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={`${t.name} 테이블${visit ? `, ${visit.party_size}명 착석` : ", 빈 자리"}`}
            aria-pressed={selected}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectTable(t.id);
              }
            }}
            onPointerDown={(e) => startDrag(e, p)}
            onPointerMove={(e) => moveDrag(e, p)}
            onPointerUp={() => endDrag(p)}
            onPointerCancel={() => setDrag(null)}
            className={`fp-table ${editMode ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer"}`}
            opacity={dragging ? 0.85 : 1}
            data-testid={`floor-table-${t.name}`}
          >
            {/* 터치 영역을 의자까지 넓힌다 */}
            <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill="transparent" />
            {selected && (
              <rect x={x - 0.95} y={y - 0.95} width={w + 1.9} height={h + 1.9} rx={0.7} fill={C.ink} opacity={0.09} />
            )}
            <rect
              className="fp-focus"
              x={x - 1}
              y={y - 1}
              width={w + 2}
              height={h + 2}
              rx={0.7}
              fill="none"
              stroke={C.ink}
              strokeWidth={0.08}
            />
            {chairs.map(([cx, cy, back], i) => {
              // 둥근 네모 좌석 + 바깥쪽 등받이 띠
              const mx = cx + (vertical ? 0.35 : 0.55);
              const my = cy + (vertical ? 0.55 : 0.35);
              const s = 0.72;
              const b = 0.16;
              const back_ = {
                up: { x: mx - s / 2, y: my - s / 2 - b * 0.6, w: s, h: b },
                down: { x: mx - s / 2, y: my + s / 2 - b * 0.4, w: s, h: b },
                left: { x: mx - s / 2 - b * 0.6, y: my - s / 2, w: b, h: s },
                right: { x: mx + s / 2 - b * 0.4, y: my - s / 2, w: b, h: s },
              }[back];
              return (
                <g key={i} filter="url(#fp-shadow)">
                  <rect x={mx - s / 2} y={my - s / 2} width={s} height={s} rx={0.2} {...FURNITURE} fill={tint} />
                  <rect x={back_.x} y={back_.y} width={back_.w} height={back_.h} rx={b / 2} {...FURNITURE} />
                </g>
              );
            })}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={0.15}
              fill={blocked ? C.blocked : tint}
              stroke={blocked ? C.blockedEdge : selected ? C.ink : accent ?? C.line}
              strokeWidth={blocked || selected ? 2 : accent ? 1.5 : 1}
              vectorEffect="non-scaling-stroke"
              filter="url(#fp-shadow)"
            />
            <Label x={x + w / 2} y={y + h / 2 - (visit ? 0.35 : 0)} size={0.72} weight={700}>
              {t.name}
            </Label>
            {visit && (
              <Label x={x + w / 2} y={y + h / 2 + 0.5} size={0.55} weight={700} fill={accent ?? C.ink}>
                {`${visit.party_size}명${visit.status === "PAID" && !vertical ? " · 결제" : ""}`}
              </Label>
            )}
            {visit?.status === "PAID" && vertical && (
              <Label x={x + w / 2} y={y + h / 2 + 1.2} size={0.55} weight={700} fill={C.paid}>
                결제
              </Label>
            )}
          </g>
        );
      })}
      </g>
      </Stretch.Provider>
    </svg>
  );
}
