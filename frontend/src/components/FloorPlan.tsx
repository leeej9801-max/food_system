import { useState } from "react";

import { FLOOR_COLS, FLOOR_ROWS } from "../types";
import type { FloorFixture, StoreTable } from "../types";

// 홀 도면 (WO-20261105-001, U-31). 좌표계 24×28칸(1칸 ≈ 34cm)을 SVG viewBox로 그려
// 화면 크기와 상관없이 비율을 유지하며 맞춘다(문서 스크롤 없음).
// H 테이블 4×2칸(의자 위·아래), V 테이블 2×4칸(의자 좌·우).

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

/** 도면이 없는 예전 매장(좌표 0..11×0..7)은 순서대로 격자에 펼쳐 겹치지 않게 그린다. */
export function placeTables(tables: StoreTable[], fixtures: FloorFixture[]): PlacedTable[] {
  const size = (t: StoreTable) => (t.orientation === "V" ? { w: 2, h: 4 } : { w: 4, h: 2 });
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

function fixtureStyle(kind: FloorFixture["kind"], pixel: boolean): { fill: string; text: string } {
  switch (kind) {
    case "ENTRANCE":
      return { fill: "#10b981", text: "#ffffff" };
    case "COUNTER":
      return { fill: pixel ? "#7c4a1e" : "#374151", text: "#ffffff" };
    case "KITCHEN":
      return { fill: "#d1d5db", text: "#374151" };
    case "PARTITION":
      return { fill: pixel ? "#a16207" : "#6b7280", text: "#ffffff" };
    default:
      return { fill: "#bfdbfe", text: "#1e3a8a" };
  }
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

/** 포인터 위치를 도면 칸 좌표(소수)로 바꾼다. viewBox는 meet로 가운데 맞춤이다. */
function toCell(evt: React.PointerEvent<SVGElement>) {
  const svg = evt.currentTarget.ownerSVGElement;
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / FLOOR_COLS, rect.height / FLOOR_ROWS);
  const offX = (rect.width - FLOOR_COLS * scale) / 2;
  const offY = (rect.height - FLOOR_ROWS * scale) / 2;
  return { x: (evt.clientX - rect.left - offX) / scale, y: (evt.clientY - rect.top - offY) / scale };
}

function tableColors(t: StoreTable, selected: boolean, pixel: boolean) {
  const status = t.active_visit?.status;
  const fill =
    status === "PAID" ? "#fef3c7" : status === "SEATED" ? "#dbeafe" : pixel ? "#f5e6c8" : "#ffffff";
  const stroke = selected ? "#111827" : status === "PAID" ? "#d97706" : status ? "#2563eb" : "#9ca3af";
  return { fill, stroke, strokeWidth: selected ? 0.18 : 0.08 };
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
  const placed = placeTables(tables, fixtures).map((p) =>
    drag && p.table.id === drag.id ? { ...p, x: drag.x, y: drag.y } : p
  );

  function startDrag(evt: React.PointerEvent<SVGGElement>, p: PlacedTable) {
    onSelectTable(p.table.id);
    if (!editMode) return;
    const cell = toCell(evt);
    if (!cell) return;
    evt.currentTarget.setPointerCapture(evt.pointerId);
    setDrag({ id: p.table.id, grabX: cell.x - p.x, grabY: cell.y - p.y, x: p.x, y: p.y, moved: false });
  }

  function moveDrag(evt: React.PointerEvent<SVGGElement>, p: PlacedTable) {
    if (!drag || drag.id !== p.table.id) return;
    const cell = toCell(evt);
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

  return (
    <svg
      viewBox={`0 0 ${FLOOR_COLS} ${FLOOR_ROWS}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full select-none"
      style={editMode ? { touchAction: "none" } : undefined}
      role="img"
      aria-label="매장 홀 도면"
    >
      <rect
        x={0}
        y={0}
        width={FLOOR_COLS}
        height={FLOOR_ROWS}
        rx={0.3}
        fill={pixel ? "#ead9b8" : "#f3f4f6"}
        stroke="#9ca3af"
        strokeWidth={0.1}
        data-testid="floor-surface"
      />
      {editMode &&
        Array.from({ length: FLOOR_COLS - 1 }, (_, i) => (
          <line key={`gx${i}`} x1={i + 1} y1={0} x2={i + 1} y2={FLOOR_ROWS} stroke="#d1d5db" strokeWidth={0.03} pointerEvents="none" />
        ))}
      {editMode &&
        Array.from({ length: FLOOR_ROWS - 1 }, (_, i) => (
          <line key={`gy${i}`} x1={0} y1={i + 1} x2={FLOOR_COLS} y2={i + 1} stroke="#d1d5db" strokeWidth={0.03} pointerEvents="none" />
        ))}

      {fixtures.map((f, i) => {
        const s = fixtureStyle(f.kind, pixel);
        return (
          <g key={`f${i}`} pointerEvents="none">
            <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={0.15} fill={s.fill} opacity={0.9} />
            {f.label && (
              <text
                x={f.x + f.w / 2}
                y={f.y + f.h / 2}
                fontSize={0.7}
                fill={s.text}
                textAnchor="middle"
                dominantBaseline="central"
                fontWeight={700}
              >
                {f.label}
              </text>
            )}
          </g>
        );
      })}

      {placed.map((p) => {
        const { table: t, x, y, w, h } = p;
        const dragging = drag?.id === t.id;
        const blocked = dragging && !canPlace(placed, fixtures, p);
        const c = blocked
          ? { fill: "#fecaca", stroke: "#dc2626", strokeWidth: 0.18 }
          : tableColors(t, t.id === selectedTableId, pixel);
        const visit = t.active_visit;
        const chairs =
          t.orientation === "V"
            ? [
                [x - 0.85, y + 0.6],
                [x - 0.85, y + 2.3],
                [x + w + 0.15, y + 0.6],
                [x + w + 0.15, y + 2.3],
              ]
            : [
                [x + 0.6, y - 0.85],
                [x + 2.3, y - 0.85],
                [x + 0.6, y + h + 0.15],
                [x + 2.3, y + h + 0.15],
              ];
        return (
          <g
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={`${t.name} 테이블${visit ? `, ${visit.party_size}명 착석` : ", 빈 자리"}`}
            aria-pressed={t.id === selectedTableId}
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
            className={editMode ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer"}
            opacity={dragging ? 0.85 : 1}
            data-testid={`floor-table-${t.name}`}
          >
            {chairs.slice(0, Math.min(t.seats, 4)).map(([cx, cy], i) => (
              <rect key={i} x={cx} y={cy} width={1.1} height={0.7} rx={0.2} fill={visit ? "#93c5fd" : "#d1d5db"} />
            ))}
            {/* 터치 영역을 의자까지 넓힌다 */}
            <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill="transparent" />
            <rect x={x} y={y} width={w} height={h} rx={0.25} fill={c.fill} stroke={c.stroke} strokeWidth={c.strokeWidth} />
            <text
              x={x + w / 2}
              y={y + h / 2 - (visit ? 0.35 : 0)}
              fontSize={0.8}
              fontWeight={800}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#111827"
            >
              {t.name}
            </text>
            {visit && (
              <text
                x={x + w / 2}
                y={y + h / 2 + 0.55}
                fontSize={0.6}
                textAnchor="middle"
                dominantBaseline="central"
                fill={visit.status === "PAID" ? "#92400e" : "#1d4ed8"}
                fontWeight={700}
              >
                {visit.party_size}명{visit.status === "PAID" ? "·결제" : ""}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
