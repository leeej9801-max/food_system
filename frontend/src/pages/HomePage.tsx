import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiClientError } from "../api/client";
import {
  createManualSalesOrder,
  fetchIntegrationStatus,
  fetchSalesOrders,
  updatePosMode,
  updateSalesOrder,
} from "../api/imports";
import { fetchMenus } from "../api/menus";
import {
  createVisitSession,
  fetchTables,
  fetchVisitSummary,
  updateTable,
  updateVisitSession,
} from "../api/stores";
import { PixelFloorMap } from "../components/PixelFloorMap";
import type { AgeBandType, Store, StoreTable } from "../types";

interface HomePageProps {
  store: Store;
  metaverseMode: boolean;
}

type AgeKey = "10대" | "20대" | "30대" | "40대" | "50대" | "60대+";

const AGE_KEYS: AgeKey[] = ["10대", "20대", "30대", "40대", "50대", "60대+"];

const AGE_KEY_TO_BAND: Record<AgeKey, AgeBandType> = {
  "10대": "10S",
  "20대": "20S",
  "30대": "30S",
  "40대": "40S",
  "50대": "50S",
  "60대+": "60S_PLUS",
};

const BAND_TO_AGE_KEY: Partial<Record<AgeBandType, AgeKey>> = {
  "10S": "10대",
  "20S": "20대",
  "30S": "30대",
  "40S": "40대",
  "50S": "50대",
  "50S_PLUS": "50대",
  "60S_PLUS": "60대+",
};

const EMPTY_AGE_COUNTS: Record<AgeKey, number> = {
  "10대": 0,
  "20대": 0,
  "30대": 0,
  "40대": 0,
  "50대": 0,
  "60대+": 0,
};

function formatAgeBreakdownNotes(
  counts: Record<AgeKey, number>,
  memo: string
): string | null {
  const parts = AGE_KEYS.filter((k) => counts[k] > 0).map(
    (k) => `${k}(${counts[k]})`
  );
  const ageTag = parts.length > 0 ? `[연령: ${parts.join(", ")}]` : "";
  const cleanMemo = memo.trim();
  if (ageTag && cleanMemo) return `${ageTag} ${cleanMemo}`;
  if (ageTag) return ageTag;
  return cleanMemo || null;
}

function parseAgeBreakdownFromSession(
  ageBand: AgeBandType,
  partySize: number,
  notes: string | null
): { counts: Record<AgeKey, number>; memo: string } {
  const counts: Record<AgeKey, number> = { ...EMPTY_AGE_COUNTS };
  let rawNotes = notes ?? "";

  const match = rawNotes.match(/^\[연령:\s*([^\]]+)\]\s*(.*)$/);
  if (match) {
    const inside = match[1];
    rawNotes = match[2] ?? "";
    for (const token of inside.split(",")) {
      const m = token.trim().match(/^(10대|20대|30대|40대|50대|60대\+)\((\d+)\)$/);
      if (m) {
        const key = m[1] as AgeKey;
        counts[key] = Number(m[2]);
      }
    }
    return { counts, memo: rawNotes };
  }

  const mappedKey = BAND_TO_AGE_KEY[ageBand];
  if (mappedKey) {
    counts[mappedKey] = partySize;
  }
  return { counts, memo: rawNotes };
}

function deriveAgeBand(counts: Record<AgeKey, number>): AgeBandType {
  const activeKeys = AGE_KEYS.filter((k) => counts[k] > 0);
  if (activeKeys.length === 0) return "UNRECORDED";
  if (activeKeys.length === 1) return AGE_KEY_TO_BAND[activeKeys[0]];
  return "MIXED";
}

function formatAgeSummaryBadge(
  ageBand: AgeBandType,
  notes: string | null
): string | null {
  if (notes) {
    const match = notes.match(/^\[연령:\s*([^\]]+)\]/);
    if (match) return match[1];
  }
  const key = BAND_TO_AGE_KEY[ageBand];
  if (key) return key;
  if (ageBand === "MIXED") return "혼성 연령";
  return null;
}

export function HomePage({ store, metaverseMode }: HomePageProps) {
  const queryClient = useQueryClient();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [editLayoutMode, setEditLayoutMode] = useState(false);
  const [partySize, setPartySize] = useState<number>(2);
  const [ageCounts, setAgeCounts] = useState<Record<AgeKey, number>>({
    ...EMPTY_AGE_COUNTS,
  });
  const [notes, setNotes] = useState<string>("");
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // 주문 수정 / 환불 모달 상태
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [manualMenuId, setManualMenuId] = useState<string>("");
  const [manualQty, setManualQty] = useState<number>(1);

  const tablesQuery = useQuery({
    queryKey: ["tables", store.id],
    queryFn: () => fetchTables(store.id, false),
  });

  const visitSummaryQuery = useQuery({
    queryKey: ["visit-summary", store.id],
    queryFn: () => fetchVisitSummary(store.id),
  });

  const integrationQuery = useQuery({
    queryKey: ["integration-status", store.id],
    queryFn: () => fetchIntegrationStatus(store.id),
  });

  const salesOrdersQuery = useQuery({
    queryKey: ["sales-orders", store.id],
    queryFn: () => fetchSalesOrders(store.id),
    enabled: orderModalOpen,
  });

  const menusQuery = useQuery({
    queryKey: ["menus", store.id, "active-for-order"],
    queryFn: () => fetchMenus(store.id, { status: "active" }),
    enabled: orderModalOpen,
  });

  const tables = tablesQuery.data ?? [];
  const selectedTable: StoreTable | null =
    tables.find((t) => t.id === selectedTableId) ?? tables[0] ?? null;

  useEffect(() => {
    if (!selectedTable) return;
    if (selectedTable.active_visit) {
      setPartySize(selectedTable.active_visit.party_size);
      const parsed = parseAgeBreakdownFromSession(
        selectedTable.active_visit.age_band,
        selectedTable.active_visit.party_size,
        selectedTable.active_visit.notes
      );
      setAgeCounts(parsed.counts);
      setNotes(parsed.memo);
    } else {
      setPartySize(Math.min(selectedTable.seats, 4));
      setAgeCounts({ ...EMPTY_AGE_COUNTS });
      setNotes("");
    }
  }, [selectedTable?.id, selectedTable?.active_visit?.id]);

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["tables", store.id] });
    queryClient.invalidateQueries({ queryKey: ["visit-summary", store.id] });
    queryClient.invalidateQueries({ queryKey: ["integration-status", store.id] });
    queryClient.invalidateQueries({ queryKey: ["sales-orders", store.id] });
    queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
    queryClient.invalidateQueries({ queryKey: ["sales-analytics", store.id] });
  }

  // 연령대 스텝퍼 조작 시 총 인원수 자동 합산 연동
  function handleAdjustAge(key: AgeKey, delta: number) {
    setAgeCounts((prev) => {
      const nextVal = Math.max(0, (prev[key] ?? 0) + delta);
      const nextCounts = { ...prev, [key]: nextVal };
      const sumAge = AGE_KEYS.reduce((acc, k) => acc + nextCounts[k], 0);
      if (sumAge > 0) {
        setPartySize(sumAge);
      }
      return nextCounts;
    });
  }

  // 연령 미상 시 상단 빠른 인원수 터치
  function handleQuickPartySize(num: number) {
    setPartySize(num);
    setAgeCounts({ ...EMPTY_AGE_COUNTS });
  }

  const totalAgeSelected = AGE_KEYS.reduce((acc, k) => acc + ageCounts[k], 0);

  const startVisitMutation = useMutation({
    mutationFn: () => {
      if (!selectedTable) throw new Error("테이블을 선택해 주세요.");
      const band = deriveAgeBand(ageCounts);
      const formattedNotes = formatAgeBreakdownNotes(ageCounts, notes);
      return createVisitSession(store.id, {
        table_id: selectedTable.id,
        party_size: partySize,
        age_band: band,
        notes: formattedNotes,
      });
    },
    onSuccess: (created) => {
      refreshAll();
      setBanner({
        type: "success",
        text: `${created.table_name}: ${created.party_size}명 착석 완료`,
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "착석 기록에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const updateVisitMutation = useMutation({
    mutationFn: (payload: {
      party_size?: number;
      age_band?: AgeBandType;
      status?: "SEATED" | "PAID" | "LEFT";
      notes?: string | null;
    }) => {
      const activeVisit = selectedTable?.active_visit;
      if (!activeVisit) throw new Error("진행 중인 방문 세션이 없습니다.");
      return updateVisitSession(store.id, activeVisit.id, payload);
    },
    onSuccess: (updated) => {
      refreshAll();
      const statusText =
        updated.status === "LEFT"
          ? "퇴점 · 테이블 비우기 완료"
          : updated.status === "PAID"
          ? "결제 완료 표시됨 (착석 유지)"
          : `${updated.party_size}명 정보 수정됨`;
      setBanner({
        type: "success",
        text: `${updated.table_name}: ${statusText}`,
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "상태 변경에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const updateOrderMutation = useMutation({
    mutationFn: (params: {
      orderId: string;
      order_status?: "COMPLETED" | "CANCELLED";
      items?: Array<{ item_id: string; quantity: number }>;
    }) =>
      updateSalesOrder(store.id, params.orderId, {
        order_status: params.order_status,
        items: params.items,
      }),
    onSuccess: () => {
      refreshAll();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "주문 수정에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const createManualOrderMutation = useMutation({
    mutationFn: () => {
      const targetMenuId = manualMenuId || menusQuery.data?.[0]?.id;
      if (!targetMenuId) throw new Error("추가할 메뉴를 선택해 주세요.");
      return createManualSalesOrder(store.id, {
        items: [{ menu_item_id: targetMenuId, quantity: manualQty }],
      });
    },
    onSuccess: () => {
      setManualQty(1);
      refreshAll();
    },
  });

  const switchToCsvModeMutation = useMutation({
    mutationFn: () => updatePosMode(store.id, "CSV_UPLOAD"),
    onSuccess: () => {
      refreshAll();
    },
  });

  const moveTableMutation = useMutation({
    mutationFn: (params: { tableId: string; gridX: number; gridY: number }) =>
      updateTable(store.id, params.tableId, {
        grid_x: params.gridX,
        grid_y: params.gridY,
      }),
    onSuccess: (moved) => {
      refreshAll();
      setBanner({
        type: "success",
        text: `${moved.name} 위치가 (${moved.grid_x + 1}열, ${moved.grid_y + 1}행)으로 이동되었습니다.`,
      });
    },
  });

  return (
    <div className="space-y-3">
      {banner && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-lg border px-4 py-2 text-xs font-bold ${
            banner.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="rounded px-2 py-0.5 text-xs underline"
          >
            닫기
          </button>
        </div>
      )}

      {/* 메인 태블릿 홀 화면: 좌측 홀 배치도(상단 네비바 iOS 스위치로 도트/심플 전환) + 우측 선택 테이블 터치 입력 패널 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.85fr_1fr]">
        {/* 좌측 홀 영역 */}
        <div className="flex flex-col">
          {metaverseMode ? (
            <PixelFloorMap
              tables={tables}
              selectedTableId={selectedTable?.id ?? null}
              onSelectTable={(id) => setSelectedTableId(id)}
              editLayoutMode={editLayoutMode}
              onToggleEditLayout={() => setEditLayoutMode((v) => !v)}
              onMoveTable={(tableId, gridX, gridY) =>
                moveTableMutation.mutate({ tableId, gridX, gridY })
              }
              isMovingTable={moveTableMutation.isPending}
              activeTableCount={visitSummaryQuery.data?.active_table_count ?? 0}
              activeGuestCount={visitSummaryQuery.data?.active_guest_count ?? 0}
            />
          ) : (
            <section className="flex min-h-[calc(100vh-120px)] flex-col justify-between rounded-lg border-2 border-gray-300 bg-gray-200/70 p-4">
              {/* 상단 홀 상태 바 (출입구 · 카운터 표시 및 범례) */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-300/80 bg-white/90 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs font-bold text-white">
                    매장 입구 · 카운터
                  </span>
                  <span className="text-sm font-bold text-gray-800">
                    매장 홀 테이블 배치
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
                  <span className="inline-flex items-center gap-1.5 text-gray-600">
                    <span className="inline-block h-3 w-3 rounded-full border border-gray-400 bg-white" />
                    빈 테이블
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-accent-700">
                    <span className="inline-block h-3 w-3 rounded-full bg-accent-600" />
                    착석중
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-amber-800">
                    <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
                    결제완료(재석)
                  </span>
                  <Link
                    to="/settings"
                    className="rounded-lg border border-gray-300 bg-gray-50 px-2.5 py-1 text-[12px] font-bold text-gray-700 hover:bg-gray-100"
                  >
                    + 테이블 배치 설정
                  </Link>
                </div>
              </div>

              {/* 심플 카드 홀 그리드 */}
              {tables.length === 0 ? (
                <div className="my-auto rounded-lg bg-white/80 p-10 text-center text-sm text-gray-600">
                  등록된 홀 테이블이 없습니다.{" "}
                  <Link to="/settings" className="font-bold text-accent-600 underline">
                    설정 화면
                  </Link>
                  에서 테이블을 추가해 주세요.
                </div>
              ) : (
                <div className="my-auto grid grid-cols-2 gap-4 py-2 sm:grid-cols-3 xl:grid-cols-3">
                  {tables.map((t) => {
                    const isSelected = selectedTable?.id === t.id;
                    const active = t.active_visit;
                    const ageSummary = active
                      ? formatAgeSummaryBadge(active.age_band, active.notes)
                      : null;
                    const topChairs = Math.ceil(Math.min(t.seats, 8) / 2);
                    const bottomChairs = Math.floor(Math.min(t.seats, 8) / 2);

                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTableId(t.id)}
                        className={`group relative flex min-h-[155px] flex-col justify-between rounded-lg border-2 p-4 text-left transition active:scale-[0.99] ${
                          isSelected
                            ? "border-accent-600 bg-white ring-4 ring-accent-500/25"
                            : active
                            ? active.status === "PAID"
                              ? "border-amber-400 bg-amber-50/95 hover:border-amber-500"
                              : "border-accent-400 bg-accent-50/95 hover:border-accent-500"
                            : "border-gray-300 bg-white/95 hover:border-gray-400"
                        }`}
                      >
                        <div className="flex justify-center gap-2">
                          {Array.from({ length: topChairs }).map((_, idx) => (
                            <span
                              key={idx}
                              className={`h-2 w-6 rounded-full ${
                                active
                                  ? active.status === "PAID"
                                    ? "bg-amber-400"
                                    : "bg-accent-500"
                                  : "bg-gray-300"
                              }`}
                            />
                          ))}
                        </div>

                        <div className="my-2">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-lg font-bold text-gray-900">
                              {t.name}
                            </span>
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[12px] font-bold text-gray-600">
                              {t.seats}인석
                            </span>
                          </div>

                          {active ? (
                            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-1">
                              <span
                                className={`text-2xl font-bold ${
                                  active.status === "PAID"
                                    ? "text-amber-900"
                                    : "text-accent-900"
                                }`}
                              >
                                {active.party_size}명
                              </span>
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                  active.status === "PAID"
                                    ? "bg-amber-200 text-amber-950"
                                    : "bg-accent-600 text-white"
                                }`}
                              >
                                {active.status === "PAID" ? "결제완료" : "착석중"}
                              </span>
                            </div>
                          ) : (
                            <div className="mt-3 text-sm font-bold text-gray-500">
                              빈 테이블 (터치하여 착석)
                            </div>
                          )}

                          {active && ageSummary && (
                            <div className="mt-1.5 truncate rounded-md bg-white/80 px-2 py-0.5 text-[12px] font-bold text-gray-700">
                              {ageSummary}
                            </div>
                          )}
                        </div>

                        <div className="flex justify-center gap-2">
                          {Array.from({ length: bottomChairs }).map((_, idx) => (
                            <span
                              key={idx}
                              className={`h-2 w-6 rounded-full ${
                                active
                                  ? active.status === "PAID"
                                    ? "bg-amber-400"
                                    : "bg-accent-500"
                                  : "bg-gray-300"
                              }`}
                            />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between rounded-lg border border-gray-300/70 bg-white/80 px-4 py-2 text-xs font-bold text-gray-600">
                <span>주방 · 서빙 패스 라인</span>
                <span>
                  이용 중:{" "}
                  <strong className="text-gray-900">
                    {visitSummaryQuery.data?.active_table_count ?? 0}테이블 (
                    {visitSummaryQuery.data?.active_guest_count ?? 0}명)
                  </strong>
                </span>
              </div>
            </section>
          )}
        </div>

        {/* 우측: 선택된 테이블 터치 입력 패널 */}
        <aside className="flex flex-col justify-between rounded-lg border-2 border-gray-300 bg-white p-5">
          {!selectedTable ? (
            <div className="py-12 text-center text-sm font-semibold text-gray-500">
              좌측 배치도에서 테이블을 터치해 주세요.
            </div>
          ) : (
            <div className="space-y-5">
              {/* 선택된 테이블 헤더 */}
              <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-gray-900">
                      {selectedTable.name}
                    </h2>
                    <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">
                      기본 {selectedTable.seats}인석
                    </span>
                  </div>
                  {selectedTable.active_visit && (
                    <div className="mt-1 text-xs font-semibold text-gray-500">
                      입점 시각:{" "}
                      {new Date(selectedTable.active_visit.seated_at).toLocaleTimeString(
                        "ko-KR",
                        { hour: "2-digit", minute: "2-digit" }
                      )}
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-xs font-bold text-gray-500">현재 인원</div>
                  <div className="text-3xl font-bold text-accent-600">
                    {partySize}명
                  </div>
                </div>
              </div>

              {/* 1. 방문 인원수 빠른 터치 (연령 미상 시 원탭) */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-800">
                    빠른 인원수 터치{" "}
                    <span className="font-normal text-gray-500">
                      (연령대 미선택 시 바로 적용)
                    </span>
                  </label>
                  {totalAgeSelected > 0 && (
                    <button
                      type="button"
                      onClick={() => setAgeCounts({ ...EMPTY_AGE_COUNTS })}
                      className="text-[12px] font-bold text-accent-600 underline"
                    >
                      연령 카운트 초기화
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleQuickPartySize(num)}
                      className={`h-11 rounded-lg border text-sm font-bold transition active:scale-95 ${
                        partySize === num && totalAgeSelected === 0
                          ? "border-accent-600 bg-accent-50 text-accent-800"
                          : "border-gray-300 bg-gray-50 text-gray-800 hover:bg-gray-100"
                      }`}
                    >
                      {num}명
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. 연령대 터치 스텝퍼: [-] 20대 (N) [+] */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-800">
                    연령대 터치 카운터{" "}
                    <span className="font-normal text-gray-500">
                      (+ 터치 시 총 인원 자동 합산)
                    </span>
                  </label>
                  {totalAgeSelected > 0 && (
                    <span className="rounded-full bg-accent-100 px-2.5 py-0.5 text-[12px] font-bold text-accent-900">
                      연령 합계 {totalAgeSelected}명
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {AGE_KEYS.map((key) => {
                    const count = ageCounts[key] ?? 0;
                    const active = count > 0;
                    return (
                      <div
                        key={key}
                        className={`flex h-13 items-center justify-between rounded-lg border-2 px-2 transition ${
                          active
                            ? "border-accent-600 bg-accent-50/80"
                            : "border-gray-200 bg-gray-50"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleAdjustAge(key, -1)}
                          disabled={count === 0}
                          aria-label={`${key} 감소`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-base font-bold text-gray-700 disabled:opacity-35 active:bg-gray-200"
                        >
                          -
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAdjustAge(key, 1)}
                          className="flex flex-1 flex-col items-center justify-center px-1 text-center"
                        >
                          <span
                            className={`text-sm font-bold ${
                              active ? "text-accent-950" : "text-gray-700"
                            }`}
                          >
                            {key}{" "}
                            <span
                              className={
                                active ? "text-accent-600" : "text-gray-500"
                              }
                            >
                              ({count})
                            </span>
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAdjustAge(key, 1)}
                          aria-label={`${key} 증가`}
                          className={`flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold transition active:scale-95 ${
                            active
                              ? "bg-accent-600 text-white"
                              : "border border-gray-300 bg-white text-gray-800"
                          }`}
                        >
                          +
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. 간단 현장 메모 */}
              <div>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="선택 메모 (예: 창가 요청, 유아 동반, 단골)"
                  className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm"
                />
              </div>

              {/* 4. 착석 / 결제 / 퇴점 핵심 액션 버튼 */}
              {!selectedTable.active_visit ? (
                <button
                  type="button"
                  onClick={() => startVisitMutation.mutate()}
                  disabled={startVisitMutation.isPending}
                  className="w-full rounded-lg bg-accent-600 py-4 text-base font-bold text-white hover:bg-accent-700 disabled:opacity-50"
                >
                  {startVisitMutation.isPending
                    ? "기록 중..."
                    : `${selectedTable.name} · ${partySize}명 착석 시작`}
                </button>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        updateVisitMutation.mutate({
                          party_size: partySize,
                          age_band: deriveAgeBand(ageCounts),
                          notes: formatAgeBreakdownNotes(ageCounts, notes),
                        })
                      }
                      disabled={updateVisitMutation.isPending}
                      className="rounded-lg border border-gray-300 bg-white py-3 text-xs font-bold text-gray-800 hover:bg-gray-100"
                    >
                      인원 · 연령 수정 저장
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updateVisitMutation.mutate({
                          status:
                            selectedTable.active_visit?.status === "PAID"
                              ? "SEATED"
                              : "PAID",
                        })
                      }
                      disabled={updateVisitMutation.isPending}
                      className="rounded-lg border border-amber-400 bg-amber-100 py-3 text-xs font-bold text-amber-950 hover:bg-amber-200"
                    >
                      {selectedTable.active_visit.status === "PAID"
                        ? "결제완료 취소 (착석중)"
                        : "결제 완료 (재석 유지)"}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => updateVisitMutation.mutate({ status: "LEFT" })}
                    disabled={updateVisitMutation.isPending}
                    className="w-full rounded-lg bg-gray-900 py-4 text-base font-bold text-white hover:bg-gray-800"
                  >
                    퇴점 · 테이블 비우기
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 우측 패널 하단: 주문 수정 · 환불 관리 모달 진입 버튼 */}
          <div className="mt-5 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={() => setOrderModalOpen(true)}
              className="flex w-full items-center justify-between rounded-lg border-2 border-gray-300 bg-gray-50 px-4 py-3 text-left hover:bg-gray-100"
            >
              <div>
                <div className="text-xs font-bold text-gray-900">
                  주문 수정 · 환불(취소) 관리
                </div>
                <div className="text-[12px] font-medium text-gray-500">
                  {integrationQuery.data?.mode === "CSV_UPLOAD"
                    ? "현재 CSV/수동 모드: 직접 수량 변경·환불 가능"
                    : "현재 POS 연동 모드: POS 단말 자동 동기화"}
                </div>
              </div>
              <span className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white">
                열기 →
              </span>
            </button>
          </div>
        </aside>
      </div>

      {/* 주문 수정 · 환불(취소) 대응 모달 (POS 자동 연동 vs CSV 직접 수정 분기) */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  주문 내역 수정 · 환불(취소) 관리
                </h3>
                <p className="text-xs text-gray-500">
                  환불(취소) 또는 수량 변경 시 예상 재고와 판매·원가 집계에 즉시
                  반영됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrderModalOpen(false)}
                className="rounded-lg border border-gray-300 px-3.5 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100"
              >
                닫기
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {/* POS 모드 vs CSV 모드 분기 배너 */}
              {salesOrdersQuery.data && !salesOrdersQuery.data.can_manual_edit ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold">
                        현재 POS 연동 모드 ({salesOrdersQuery.data.pos_mode})
                      </div>
                      <p className="mt-1">{salesOrdersQuery.data.mode_notice}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => switchToCsvModeMutation.mutate()}
                      className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800"
                    >
                      CSV/수동 모드로 전환하여 직접 수정하기
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-950">
                  <div className="font-bold">
                    CSV / 수동 관리 모드 활성화됨
                  </div>
                  <p className="mt-0.5">
                    아래 주문 목록에서 품목 수량을 직접 증감하거나 환불(주문취소)로 전환할 수
                    있으며, 현장 누락 주문을 즉시 추가할 수 있습니다.
                  </p>

                  {/* 현장 수동 주문 빠른 추가 바 */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-emerald-200/80 pt-3">
                    <span className="font-bold text-emerald-900">+ 현장 주문 추가:</span>
                    <select
                      value={manualMenuId || menusQuery.data?.[0]?.id || ""}
                      onChange={(e) => setManualMenuId(e.target.value)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800"
                    >
                      {(menusQuery.data ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} (
                          {m.selling_price
                            ? `${Number(m.selling_price).toLocaleString("ko-KR")}원`
                            : "가격미설정"}
                          )
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setManualQty((q) => Math.max(1, q - 1))}
                        className="h-7 w-7 rounded border border-gray-300 bg-white font-bold"
                      >
                        -
                      </button>
                      <span className="px-2 font-bold">{manualQty}개</span>
                      <button
                        type="button"
                        onClick={() => setManualQty((q) => q + 1)}
                        className="h-7 w-7 rounded border border-gray-300 bg-white font-bold"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => createManualOrderMutation.mutate()}
                      disabled={
                        createManualOrderMutation.isPending ||
                        (menusQuery.data?.length ?? 0) === 0
                      }
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      + 주문 등록
                    </button>
                  </div>
                </div>
              )}

              {/* 수집된 주문 목록 */}
              {salesOrdersQuery.isLoading ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  주문 내역을 불러오는 중입니다...
                </div>
              ) : (salesOrdersQuery.data?.orders.length ?? 0) === 0 ? (
                <div className="rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
                  수집된 판매 주문이 없습니다. 위에서 현장 주문을 추가하거나{" "}
                  <Link
                    to="/settings"
                    onClick={() => setOrderModalOpen(false)}
                    className="font-bold text-accent-600 underline"
                  >
                    설정
                  </Link>
                  에서 판매 CSV를 업로드해 보세요.
                </div>
              ) : (
                <div className="space-y-3">
                  {salesOrdersQuery.data?.orders.map((order) => {
                    const isCancelled = order.order_status === "CANCELLED";
                    const canEdit = salesOrdersQuery.data?.can_manual_edit ?? false;

                    return (
                      <div
                        key={order.id}
                        className={`rounded-lg border p-4 ${
                          isCancelled
                            ? "border-red-200 bg-red-50/40"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-900">
                              {order.external_order_id}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${
                                isCancelled
                                  ? "bg-red-100 text-red-800"
                                  : "bg-emerald-100 text-emerald-900"
                              }`}
                            >
                              {isCancelled ? "환불 / 주문취소됨" : "정상 결제"}
                            </span>
                            <span className="text-xs text-gray-500">
                              {order.ordered_at
                                ? new Date(order.ordered_at).toLocaleString("ko-KR")
                                : "시각 미상"}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <span
                              className={`text-sm font-bold ${
                                isCancelled
                                  ? "text-gray-500 line-through"
                                  : "text-gray-900"
                              }`}
                            >
                              {Number(order.total_amount).toLocaleString("ko-KR")}원
                            </span>

                            <button
                              type="button"
                              disabled={!canEdit || updateOrderMutation.isPending}
                              onClick={() =>
                                updateOrderMutation.mutate({
                                  orderId: order.id,
                                  order_status: isCancelled ? "COMPLETED" : "CANCELLED",
                                })
                              }
                              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
                                isCancelled
                                  ? "border border-gray-300 bg-white text-gray-800 hover:bg-gray-100"
                                  : "bg-red-600 text-white hover:bg-red-700"
                              }`}
                            >
                              {isCancelled ? "정상 주문으로 복구" : "환불 · 주문취소"}
                            </button>
                          </div>
                        </div>

                        {/* 주문 내 상세 품목 수량 조절 */}
                        <div className="mt-2.5 space-y-2">
                          {order.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-gray-800">
                                  {item.menu_name ?? item.raw_product_name}
                                </span>
                                <span className="text-gray-500">
                                  단가 {Number(item.unit_price).toLocaleString("ko-KR")}원
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    !canEdit ||
                                    isCancelled ||
                                    item.quantity <= 1 ||
                                    updateOrderMutation.isPending
                                  }
                                  onClick={() =>
                                    updateOrderMutation.mutate({
                                      orderId: order.id,
                                      items: [
                                        {
                                          item_id: item.id,
                                          quantity: item.quantity - 1,
                                        },
                                      ],
                                    })
                                  }
                                  className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 bg-white font-bold disabled:opacity-35"
                                >
                                  -
                                </button>
                                <span className="min-w-[36px] text-center font-bold text-gray-900">
                                  {item.quantity}개
                                </span>
                                <button
                                  type="button"
                                  disabled={
                                    !canEdit ||
                                    isCancelled ||
                                    updateOrderMutation.isPending
                                  }
                                  onClick={() =>
                                    updateOrderMutation.mutate({
                                      orderId: order.id,
                                      items: [
                                        {
                                          item_id: item.id,
                                          quantity: item.quantity + 1,
                                        },
                                      ],
                                    })
                                  }
                                  className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 bg-white font-bold disabled:opacity-35"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
