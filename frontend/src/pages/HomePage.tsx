import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLink as Link } from "../components/AppLink";
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
  updateVisitSlot,
} from "../api/stores";
import { FloorPlan } from "../components/FloorPlan";
import type {
  AgeBandType,
  GenderType,
  PurposeType,
  RelationshipType,
  Store,
  StoreTable,
  VisitSlot,
} from "../types";

interface HomePageProps {
  store: Store;
  metaverseMode: boolean;
}

// 사람별·세션별 선택값 (U-31). 목적·관계 선택지는 PROVISIONAL (사장님 확인 전)
const AGE_OPTIONS: Array<{ band: AgeBandType; label: string }> = [
  { band: "10S", label: "10대" },
  { band: "20S", label: "20대" },
  { band: "30S", label: "30대" },
  { band: "40S", label: "40대" },
  { band: "50S", label: "50대" },
  { band: "60S_PLUS", label: "60+" },
];

const GENDER_OPTIONS: Array<{ value: GenderType; label: string }> = [
  { value: "FEMALE", label: "여" },
  { value: "MALE", label: "남" },
];

const PURPOSE_OPTIONS: Array<{ value: PurposeType; label: string }> = [
  { value: "MEAL", label: "식사" },
  { value: "DATE", label: "데이트" },
  { value: "GATHERING", label: "모임" },
  { value: "FAMILY", label: "가족" },
  { value: "COMPANY", label: "회식" },
  { value: "OTHER", label: "기타" },
];

const RELATIONSHIP_OPTIONS: Array<{ value: RelationshipType; label: string }> = [
  { value: "ALONE", label: "혼자" },
  { value: "COUPLE", label: "연인" },
  { value: "FRIENDS", label: "친구" },
  { value: "FAMILY", label: "가족" },
  { value: "COWORKERS", label: "동료" },
  { value: "OTHER", label: "기타" },
];

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

function chipClass(active: boolean, disabled = false): string {
  if (disabled) {
    return active
      ? "border-gray-400 bg-gray-300 text-gray-700"
      : "border-gray-200 bg-gray-50 text-gray-300";
  }
  return active
    ? "border-gray-900 bg-gray-900 text-white"
    : "border-gray-300 bg-white text-gray-800 active:bg-gray-100";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiClientError || err instanceof Error ? err.message : fallback;
}

export function HomePage({ store, metaverseMode }: HomePageProps) {
  const queryClient = useQueryClient();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [editLayoutMode, setEditLayoutMode] = useState(false);
  const [partySize, setPartySize] = useState<number>(2);
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
  const activeVisit = selectedTable?.active_visit ?? null;

  // 선택 테이블이나 그 방문이 바뀌면 입력값을 맞춘다. 효과 대신 렌더 중에 비교한다.
  const tableKey = `${selectedTable?.id ?? ""}:${selectedTable?.active_visit?.id ?? ""}`;
  const [prevTableKey, setPrevTableKey] = useState<string | null>(null);
  if (selectedTable && prevTableKey !== tableKey) {
    setPrevTableKey(tableKey);
    if (selectedTable.active_visit) {
      setPartySize(selectedTable.active_visit.party_size);
      setNotes(selectedTable.active_visit.notes ?? "");
    } else {
      setPartySize(Math.min(selectedTable.seats, 4));
      setNotes("");
    }
  }

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["tables", store.id] });
    queryClient.invalidateQueries({ queryKey: ["visit-summary", store.id] });
    queryClient.invalidateQueries({ queryKey: ["integration-status", store.id] });
    queryClient.invalidateQueries({ queryKey: ["sales-orders", store.id] });
    queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
    queryClient.invalidateQueries({ queryKey: ["sales-analytics", store.id] });
  }

  const startVisitMutation = useMutation({
    mutationFn: () => {
      if (!selectedTable) throw new Error("테이블을 선택해 주세요.");
      return createVisitSession(store.id, {
        table_id: selectedTable.id,
        party_size: partySize,
        age_band: "UNRECORDED", // 사람별 입력에서 다시 계산
        notes: notes.trim() || null,
      });
    },
    onSuccess: (created) => {
      refreshAll();
      setBanner({
        type: "success",
        text: `${created.table_name}: ${created.party_size}명 착석. 성별·연령은 손님이 안 넣으면 입력해 주세요.`,
      });
    },
    onError: (err: unknown) => {
      setBanner({ type: "error", text: errorText(err, "착석 기록에 실패했습니다.") });
    },
  });

  const updateVisitMutation = useMutation({
    mutationFn: (payload: {
      party_size?: number;
      status?: "SEATED" | "PAID" | "LEFT";
      purpose?: PurposeType;
      relationship?: RelationshipType;
    }) => {
      if (!activeVisit) throw new Error("진행 중인 방문 세션이 없습니다.");
      return updateVisitSession(store.id, activeVisit.id, payload);
    },
    onSuccess: (updated, payload) => {
      refreshAll();
      if (payload.status) {
        setBanner({
          type: "success",
          text: `${updated.table_name}: ${
            updated.status === "LEFT"
              ? "퇴점 · 테이블 비우기 완료"
              : updated.status === "PAID"
                ? "결제 완료 (착석 유지)"
                : "착석 중으로 되돌림"
          }`,
        });
      }
    },
    onError: (err: unknown) => {
      setBanner({ type: "error", text: errorText(err, "상태 변경에 실패했습니다.") });
    },
  });

  const slotMutation = useMutation({
    mutationFn: (params: { slotNo: number; gender?: GenderType; age_band?: AgeBandType }) => {
      if (!activeVisit) throw new Error("진행 중인 방문 세션이 없습니다.");
      return updateVisitSlot(store.id, activeVisit.id, params.slotNo, {
        gender: params.gender,
        age_band: params.age_band,
      });
    },
    onSuccess: () => refreshAll(),
    onError: (err: unknown) => {
      setBanner({ type: "error", text: errorText(err, "객층 입력에 실패했습니다.") });
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
    mutationFn: (params: {
      tableId: string;
      gridX?: number;
      gridY?: number;
      orientation?: "H" | "V";
    }) =>
      updateTable(store.id, params.tableId, {
        grid_x: params.gridX,
        grid_y: params.gridY,
        orientation: params.orientation,
      }),
    onSuccess: () => refreshAll(),
    onError: (err: unknown) => {
      setBanner({ type: "error", text: errorText(err, "테이블 이동에 실패했습니다.") });
    },
  });

  const slots: VisitSlot[] = activeVisit?.slots ?? [];
  const contextByGuest = activeVisit?.context_source === "GUEST";
  const busy = updateVisitMutation.isPending || slotMutation.isPending;

  return (
    <div
      className="flex min-h-0 flex-col gap-2"
      style={{ height: "calc(var(--app-viewport-height) - var(--app-header-height, 56px) - 2rem)" }}
    >
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


      {/* 기록 화면 (U-31): 문서 스크롤 없이 도면 + 입력 패널. 가로 화면은 좌우, 세로 화면은 위아래 */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2 landscape:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] landscape:grid-rows-1">
        <section className="flex min-h-0 flex-col rounded-lg border border-gray-300 bg-white p-2">
          <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs font-bold">
            <div className="flex items-center gap-3 text-gray-700">
              <span>
                이용 {visitSummaryQuery.data?.active_table_count ?? 0}테이블 ·{" "}
                {visitSummaryQuery.data?.active_guest_count ?? 0}명
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-blue-600 bg-blue-100" />
                착석
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-600 bg-amber-100" />
                결제
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {editLayoutMode && selectedTable && (
                <button
                  type="button"
                  onClick={() =>
                    moveTableMutation.mutate({
                      tableId: selectedTable.id,
                      orientation: selectedTable.orientation === "V" ? "H" : "V",
                    })
                  }
                  className="h-8 rounded-md border border-gray-300 px-2.5"
                >
                  {selectedTable.name} 방향 바꾸기
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditLayoutMode((v) => !v)}
                className={`h-8 rounded-md border px-2.5 ${chipClass(editLayoutMode)}`}
              >
                {editLayoutMode ? "배치 끝내기" : "배치 편집"}
              </button>
            </div>
          </div>
          {editLayoutMode && (
            <p className="mb-1 shrink-0 text-[11px] text-gray-500">
              테이블을 고른 뒤 도면의 빈 곳을 누르면 그 위치로 옮깁니다.
            </p>
          )}
          <div className="min-h-0 flex-1">
            {tables.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-600">
                등록된 테이블이 없습니다.&nbsp;
                <Link to="/settings" className="font-bold text-accent-600 underline">
                  설정
                </Link>
                에서 추가해 주세요.
              </div>
            ) : (
              <FloorPlan
                tables={tables}
                fixtures={store.floor_fixtures ?? []}
                selectedTableId={selectedTable?.id ?? null}
                onSelectTable={(id) => setSelectedTableId(id)}
                editMode={editLayoutMode}
                onMoveTable={(tableId, gridX, gridY) =>
                  moveTableMutation.mutate({ tableId, gridX, gridY })
                }
                pixel={metaverseMode}
              />
            )}
          </div>
        </section>

        <aside
          className="flex min-h-0 flex-col gap-2 rounded-lg border border-gray-300 bg-white p-3 text-sm"
          data-testid="visit-panel"
        >
          {!selectedTable ? (
            <p className="text-gray-500">테이블을 선택해 주세요.</p>
          ) : (
            <>
              <div className="flex shrink-0 items-baseline justify-between">
                <h2 className="text-base font-bold text-gray-900">{selectedTable.name}</h2>
                <span className="text-xs font-semibold text-gray-600">
                  {activeVisit
                    ? `${activeVisit.status === "PAID" ? "결제 완료" : "착석"} · ${formatTime(activeVisit.seated_at)}부터`
                    : "빈 테이블"}
                </span>
              </div>

              <div className="shrink-0">
                <div className="mb-1 text-[11px] font-bold text-gray-500">
                  인원{activeVisit?.party_size_source === "GUEST_QR" ? " (손님 입력)" : ""}
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {PARTY_SIZES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPartySize(n);
                        if (activeVisit && activeVisit.party_size !== n) {
                          updateVisitMutation.mutate({ party_size: n });
                        }
                      }}
                      className={`h-9 rounded-md border text-sm font-bold ${chipClass(
                        (activeVisit?.party_size ?? partySize) === n
                      )}`}
                    >
                      {n === 8 ? "8+" : n}
                    </button>
                  ))}
                </div>
              </div>

              {!activeVisit ? (
                <>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={200}
                    placeholder="메모 (선택)"
                    className="h-9 shrink-0 rounded-md border border-gray-300 px-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={startVisitMutation.isPending}
                    onClick={() => startVisitMutation.mutate()}
                    className="h-12 shrink-0 rounded-lg bg-gray-900 text-base font-bold text-white disabled:opacity-50"
                  >
                    {partySize}명 착석 시작
                  </button>
                  <p className="text-[11px] text-gray-500">
                    착석 후 사람별 성별·연령과 방문 목적을 고릅니다. 손님이 QR로 넣으면 그 값이 우선입니다.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mb-1 shrink-0 text-[11px] font-bold text-gray-500">
                      사람별 성별·연령
                    </div>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                      {slots.map((slot) => {
                        const byGuest = slot.profile_source === "GUEST";
                        return (
                          <div key={slot.slot_no} className="flex items-center gap-1" data-testid="slot-row">
                            <span className="w-7 shrink-0 text-xs font-bold text-gray-600">
                              {byGuest ? "손님" : `${slot.slot_no}번`}
                            </span>
                            {GENDER_OPTIONS.map((g) => (
                              <button
                                key={g.value}
                                type="button"
                                disabled={byGuest || busy}
                                onClick={() => slotMutation.mutate({ slotNo: slot.slot_no, gender: g.value })}
                                className={`h-8 w-8 shrink-0 rounded-md border text-xs font-bold ${chipClass(slot.gender === g.value, byGuest)}`}
                              >
                                {g.label}
                              </button>
                            ))}
                            <div className="grid flex-1 grid-cols-6 gap-0.5">
                              {AGE_OPTIONS.map((a) => (
                                <button
                                  key={a.band}
                                  type="button"
                                  disabled={byGuest || busy}
                                  onClick={() => slotMutation.mutate({ slotNo: slot.slot_no, age_band: a.band })}
                                  className={`h-8 rounded-md border text-[11px] font-bold ${chipClass(slot.age_band === a.band, byGuest)}`}
                                >
                                  {a.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(
                    [
                      ["방문 목적", PURPOSE_OPTIONS, activeVisit.purpose, "purpose"],
                      ["동반 관계", RELATIONSHIP_OPTIONS, activeVisit.relationship, "relationship"],
                    ] as const
                  ).map(([label, options, current, key]) => (
                    <div key={key} className="shrink-0">
                      <div className="mb-1 text-[11px] font-bold text-gray-500">
                        {label}
                        {contextByGuest ? " (손님 입력)" : ""}
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {options.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            disabled={contextByGuest || busy}
                            onClick={() => updateVisitMutation.mutate({ [key]: o.value })}
                            className={`h-8 rounded-md border text-xs font-bold ${chipClass(current === o.value, contextByGuest)}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="grid shrink-0 grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        updateVisitMutation.mutate({
                          status: activeVisit.status === "PAID" ? "SEATED" : "PAID",
                        })
                      }
                      className="h-11 rounded-lg border-2 border-amber-500 bg-amber-50 text-sm font-bold text-amber-900"
                    >
                      {activeVisit.status === "PAID" ? "결제 취소" : "결제 완료"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateVisitMutation.mutate({ status: "LEFT" })}
                      className="h-11 rounded-lg bg-gray-900 text-sm font-bold text-white"
                    >
                      퇴점 (비우기)
                    </button>
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => setOrderModalOpen(true)}
                className="mt-auto h-9 shrink-0 rounded-md border border-gray-300 bg-gray-50 text-xs font-bold text-gray-700"
              >
                주문 수정 · 환불 ({integrationQuery.data?.mode === "CSV_UPLOAD" ? "CSV/수동" : "POS 연동"})
              </button>
            </>
          )}
        </aside>
      </div>

      {/* 주문 수정 · 환불(취소) 대응 모달 (POS 자동 연동 vs CSV 직접 수정 분기) */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4">
          <div className="flex max-h-[calc(var(--app-viewport-height)*0.9)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
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
