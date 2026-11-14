import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../api/client";
import {
  commitSalesCsv,
  fetchIntegrationStatus,
  fetchProductMappings,
  fetchSampleSalesCsv,
  previewSalesCsv,
  updatePosMode,
  upsertProductMapping,
} from "../api/imports";
import { fetchMenus } from "../api/menus";
import {
  createTable,
  fetchTables,
  seedWesternDemo,
  updateStore,
  updateTable,
} from "../api/stores";
import {
  ALL_DAYS,
  CLOSE_TIME_OPTIONS,
  OPEN_TIME_OPTIONS,
} from "../app/App";
import type { CsvPreviewResponse, PosModeType, Store } from "../types";

interface SettingsPageProps {
  store: Store;
}

const MODE_DESCRIPTIONS: Record<
  PosModeType,
  { title: string; badge: string }
> = {
  CSV_UPLOAD: {
    title: "모드 C · CSV/Excel 파일 업로드",
    badge: "즉시 사용 가능",
  },
  TOSS_OPEN_API: {
    title: "모드 A · 토스플레이스 Open API",
    badge: "미검증",
  },
  TOSS_PLUGIN: {
    title: "모드 B · 토스 프론트 플러그인 SDK",
    badge: "미검증",
  },
};

export function SettingsPage({ store }: SettingsPageProps) {
  const queryClient = useQueryClient();
  const [storeName, setStoreName] = useState(store.name);
  const [businessDays, setBusinessDays] = useState(
    store.business_days ?? "화,수,목,금,토,일"
  );
  const [openingHours, setOpeningHours] = useState(
    store.opening_hours ?? "11:30-22:00"
  );

  const [newTableName, setNewTableName] = useState("");
  const [newTableSeats, setNewTableSeats] = useState("4");
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // CSV Upload & Mapping state
  const [csvFileName, setCsvFileName] = useState("sales_export.csv");
  const [csvText, setCsvText] = useState("");
  const [orderIdCol, setOrderIdCol] = useState("order_id");
  const [orderedAtCol, setOrderedAtCol] = useState("ordered_at");
  const [productNameCol, setProductNameCol] = useState("menu_name");
  const [quantityCol, setQuantityCol] = useState("quantity");
  const [unitPriceCol, setUnitPriceCol] = useState("unit_price");
  const [statusCol, setStatusCol] = useState("status");
  const [previewResult, setPreviewResult] = useState<CsvPreviewResponse | null>(
    null
  );
  const [selectedMenuByExtName, setSelectedMenuByExtName] = useState<
    Record<string, string>
  >({});

  const integrationQuery = useQuery({
    queryKey: ["integration-status", store.id],
    queryFn: () => fetchIntegrationStatus(store.id),
  });

  const mappingsQuery = useQuery({
    queryKey: ["product-mappings", store.id],
    queryFn: () => fetchProductMappings(store.id),
  });

  const menusQuery = useQuery({
    queryKey: ["menus", store.id, "active-for-mapping"],
    queryFn: () => fetchMenus(store.id, { status: "active" }),
  });

  const tablesQuery = useQuery({
    queryKey: ["tables", store.id, "include-inactive"],
    queryFn: () => fetchTables(store.id, true),
  });

  function refreshIntegration() {
    queryClient.invalidateQueries({ queryKey: ["integration-status", store.id] });
    queryClient.invalidateQueries({ queryKey: ["product-mappings", store.id] });
  }

  const updateModeMutation = useMutation({
    mutationFn: (mode: PosModeType) => updatePosMode(store.id, mode),
    onSuccess: (updated) => {
      refreshIntegration();
      setBanner({
        type: "success",
        text: `POS 데이터 수집 모드가 '${updated.mode}' (${updated.connection_status})로 변경되었습니다.`,
      });
    },
  });

  const loadSampleCsvMutation = useMutation({
    mutationFn: () => fetchSampleSalesCsv(store.id),
    onSuccess: (sample) => {
      setCsvFileName(sample.file_name);
      setCsvText(sample.csv_text);
      setPreviewResult(null);
      setBanner({
        type: "success",
        text: "양식당 샘플 판매 CSV가 입력란에 로드되었습니다. '미리보기 검증' 버튼을 눌러 확인하세요.",
      });
    },
  });

  const previewCsvMutation = useMutation({
    mutationFn: () =>
      previewSalesCsv(store.id, {
        file_name: csvFileName.trim() || "sales_export.csv",
        csv_text: csvText,
        mapping: {
          order_id_col: orderIdCol.trim() || "order_id",
          ordered_at_col: orderedAtCol.trim() || "ordered_at",
          product_name_col: productNameCol.trim() || "menu_name",
          quantity_col: quantityCol.trim() || "quantity",
          unit_price_col: unitPriceCol.trim() || "unit_price",
          status_col: statusCol.trim() || "status",
        },
      }),
    onSuccess: (res) => {
      setPreviewResult(res);
      setBanner({
        type: "success",
        text: `CSV 미리보기 완료: 유효 ${res.rows_valid}행 / 오류 ${res.rows_error}행 / 미매핑 상품 ${res.unmapped_product_names.length}종`,
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "CSV 미리보기에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const commitCsvMutation = useMutation({
    mutationFn: (batchId: string) => commitSalesCsv(store.id, batchId),
    onSuccess: (res) => {
      refreshIntegration();
      setPreviewResult(null);
      setBanner({
        type: "success",
        text: `판매 데이터 확정 반영 완료: 주문 ${res.orders_upserted}건 (${res.items_recorded}개 품목) 저장됨.`,
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "판매 데이터 반영에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const upsertMappingMutation = useMutation({
    mutationFn: ({
      externalName,
      menuItemId,
    }: {
      externalName: string;
      menuItemId: string;
    }) =>
      upsertProductMapping(store.id, {
        external_product_name: externalName,
        menu_item_id: menuItemId,
      }),
    onSuccess: (res) => {
      refreshIntegration();
      setBanner({
        type: "success",
        text: `외부 상품명 '${res.external_product_name}' → 메뉴 '${res.menu_name}' 연결 완료 (기존 판매항목 ${res.retroactive_updated_items}건 소급 갱신됨).`,
      });
    },
  });

  const updateStoreMutation = useMutation({
    mutationFn: () =>
      updateStore(store.id, {
        name: storeName.trim(),
        business_days: businessDays.trim(),
        opening_hours: openingHours.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stores"] });
      setBanner({ type: "success", text: "매장 기본정보가 저장되었습니다." });
    },
  });

  const addTableMutation = useMutation({
    mutationFn: () => {
      const count = (tablesQuery.data ?? []).length;
      return createTable(store.id, {
        name: newTableName.trim() || `T${count + 1}`,
        seats: Math.max(1, Number(newTableSeats) || 4),
        grid_x: (count % 3) * 2,
        grid_y: Math.floor(count / 3) * 2,
      });
    },
    onSuccess: (created) => {
      setNewTableName("");
      queryClient.invalidateQueries({ queryKey: ["tables", store.id] });
      setBanner({
        type: "success",
        text: `테이블 '${created.name}' 항목이 추가되었습니다.`,
      });
    },
  });

  const patchTableMutation = useMutation({
    mutationFn: ({
      tableId,
      payload,
    }: {
      tableId: string;
      payload: Parameters<typeof updateTable>[2];
    }) => updateTable(store.id, tableId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tables", store.id] });
    },
  });

  const seedDemoMutation = useMutation({
    mutationFn: () => seedWesternDemo(store.id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["menus", store.id] });
      queryClient.invalidateQueries({ queryKey: ["ingredients", store.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-receipts", store.id] });
      queryClient.invalidateQueries({ queryKey: ["analytics-costing", store.id] });
      setBanner({
        type: "success",
        text: `양식당 프로토타입 기본 마스터 세팅 완료 (신규 식자재 ${res.ingredients_created}종 · 메뉴 ${res.menus_created}종 · 초기 입고단가 ${res.receipts_created}건 생성, 가짜 매출은 주입되지 않음).`,
      });
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ""));
      setPreviewResult(null);
    };
    reader.readAsText(file, "utf-8");
  }

  const integration = integrationQuery.data;
  const activeMenus = menusQuery.data ?? [];
  const allUnmapped = Array.from(
    new Set([
      ...(integration?.unmapped_products ?? []),
      ...(previewResult?.unmapped_product_names ?? []),
    ])
  );

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div className="page-title">
          <h1>설정</h1>
          <span className="title-divider" />
          <span className="title-meta">
            {store.name} · {integration?.mode === "CSV_UPLOAD" ? "CSV 수집 모드" : "POS 연동 모드"}
          </span>
        </div>

        <div className="page-actions">
          <button
            type="button"
            onClick={() => seedDemoMutation.mutate()}
            disabled={seedDemoMutation.isPending}
            className="pill pill-secondary disabled:opacity-50"
          >
            {seedDemoMutation.isPending
              ? "프로토타입 데이터 준비 중..."
              : "양식당 프로토타입 마스터(식자재·메뉴·레시피·단가) 원클릭 세팅"}
          </button>
        </div>
      </div>

      {banner && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium ${
            banner.type === "success"
              ? "bg-emerald-50 text-emerald-900"
              : "bg-red-50 text-red-900"
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="pill pill-sm pill-soft"
          >
            닫기
          </button>
        </div>
      )}

      {/* POS 연결 모드 선택 및 CSV 파일 수집 */}
      <section className="card space-y-5">
        <div className="card-head flex-wrap gap-2">
          <h2>데이터 수집 어댑터 모드 (A / B / C)</h2>
          {integration && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span
                className={`chip ${
                  integration.connection_status === "READY_CSV" ? "chip-ok" : "chip-warn"
                }`}
              >
                {integration.connection_status === "READY_CSV"
                  ? "CSV 파일 수집 준비됨"
                  : "미검증"}
              </span>
              <span className="card-meta tabular-nums">
                누적 완료 주문 <strong className="text-ink">{integration.total_orders_count}건</strong> · 순매출{" "}
                <strong className="text-ink">
                  {Number(integration.net_sales_amount).toLocaleString("ko-KR")}원
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* 모드 A / B / C 카드 */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(["CSV_UPLOAD", "TOSS_OPEN_API", "TOSS_PLUGIN"] as PosModeType[]).map(
            (m) => {
              const selected = integration?.mode === m;
              const info = MODE_DESCRIPTIONS[m];
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateModeMutation.mutate(m)}
                  className={`flex flex-col justify-between rounded-2xl p-4 text-left transition ${
                    selected
                      ? "bg-accent-50 ring-2 ring-accent-600"
                      : "bg-ground hover:bg-accent-50/50"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-ink">
                        {info.title}
                      </span>
                      <span
                        className={`chip ${
                          m === "CSV_UPLOAD" ? "chip-ok" : "chip-warn"
                        }`}
                      >
                        {info.badge}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 text-xs font-semibold text-accent-600">
                    {selected ? "현재 선택된 모드" : "이 모드로 전환"}
                  </div>
                </button>
              );
            }
          )}
        </div>

        {/* CSV 업로드 및 컬럼 매핑 영역 */}
        <div className="rounded-2xl bg-ground p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-ink">
              판매 데이터 CSV 업로드 · 미리보기 · 확정 반영
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadSampleCsvMutation.mutate()}
                className="pill pill-sm pill-secondary"
              >
                양식당 샘플 CSV 불러오기
              </button>
              <label className="pill pill-sm pill-soft !bg-white cursor-pointer">
                로컬 CSV 파일 선택
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* 컬럼 매핑 설정 */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-6">
            <div>
              <label htmlFor="settings-f1" className="block text-[12px] font-semibold text-muted">
                주문번호 컬럼
              </label>
              <input
                id="settings-f1"
                type="text"
                value={orderIdCol}
                onChange={(e) => setOrderIdCol(e.target.value)}
                className="mt-1 w-full rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              />
            </div>
            <div>
              <label htmlFor="settings-f2" className="block text-[12px] font-semibold text-muted">
                주문시각 컬럼
              </label>
              <input
                id="settings-f2"
                type="text"
                value={orderedAtCol}
                onChange={(e) => setOrderedAtCol(e.target.value)}
                className="mt-1 w-full rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              />
            </div>
            <div>
              <label htmlFor="settings-f3" className="block text-[12px] font-semibold text-muted">
                상품명 컬럼
              </label>
              <input
                id="settings-f3"
                type="text"
                value={productNameCol}
                onChange={(e) => setProductNameCol(e.target.value)}
                className="mt-1 w-full rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              />
            </div>
            <div>
              <label htmlFor="settings-f4" className="block text-[12px] font-semibold text-muted">
                수량 컬럼
              </label>
              <input
                id="settings-f4"
                type="text"
                value={quantityCol}
                onChange={(e) => setQuantityCol(e.target.value)}
                className="mt-1 w-full rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              />
            </div>
            <div>
              <label htmlFor="settings-f5" className="block text-[12px] font-semibold text-muted">
                단가 컬럼
              </label>
              <input
                id="settings-f5"
                type="text"
                value={unitPriceCol}
                onChange={(e) => setUnitPriceCol(e.target.value)}
                className="mt-1 w-full rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              />
            </div>
            <div>
              <label htmlFor="settings-f6" className="block text-[12px] font-semibold text-muted">
                상태 컬럼
              </label>
              <input
                id="settings-f6"
                type="text"
                value={statusCol}
                onChange={(e) => setStatusCol(e.target.value)}
                className="mt-1 w-full rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              />
            </div>
          </div>

          <div>
            <label htmlFor="settings-f7" className="mb-1.5 block text-xs font-semibold text-ink">
              CSV 원문 ({csvFileName})
            </label>
            <textarea
              id="settings-f7"
              rows={5}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setPreviewResult(null);
              }}
              placeholder="CSV 내용"
              className="w-full rounded-xl bg-white p-3 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={!csvText.trim() || previewCsvMutation.isPending}
              onClick={() => previewCsvMutation.mutate()}
              className="pill pill-dark disabled:opacity-50"
            >
              {previewCsvMutation.isPending
                ? "검증 중..."
                : "1단계: 미리보기 검증"}
            </button>

            {previewResult && previewResult.rows_valid > 0 && (
              <button
                type="button"
                disabled={commitCsvMutation.isPending}
                onClick={() => commitCsvMutation.mutate(previewResult.batch_id)}
                className="pill pill-primary disabled:opacity-50"
              >
                {commitCsvMutation.isPending
                  ? "반영 중..."
                  : `2단계: 유효 ${previewResult.rows_valid}행 판매 데이터 확정 반영`}
              </button>
            )}
          </div>

          {/* 미리보기 결과 요약 및 상세 */}
          {previewResult && (
            <div className="rounded-2xl bg-white p-4 space-y-3">
              {previewResult.duplicate_file_warning && (
                <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  이전에 이미 반영된 동일한 CSV 파일입니다. 다시 반영하더라도 주문번호 기준으로 덮어쓰므로 매출이 중복 합산되지 않습니다.
                </div>
              )}

              <div className="flex flex-wrap gap-3 text-xs tabular-nums">
                <span className="chip chip-idle">
                  총 행수 <strong>{previewResult.rows_total}</strong>
                </span>
                <span className="chip chip-ok">
                  유효 행 <strong>{previewResult.rows_valid}</strong>
                </span>
                <span className="chip chip-danger">
                  오류 행 <strong>{previewResult.rows_error}</strong>
                </span>
                <span className="chip chip-warn">
                  미매핑 행 <strong>{previewResult.rows_unmapped}</strong>
                </span>
              </div>

              {previewResult.errors.length > 0 && (
                <div className="rounded-xl bg-red-50 p-3 text-xs text-red-900">
                  <div className="font-bold">오류 행 사유 (반영에서 제외됨):</div>
                  <ul className="mt-1 list-disc pl-4">
                    {previewResult.errors.map((err) => (
                      <li key={err.row_number}>
                        {err.row_number}행: {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {previewResult.sample_valid_rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="!text-right">행</th>
                        <th>주문번호</th>
                        <th>주문시각</th>
                        <th>상품명 (POS/CSV)</th>
                        <th>매핑 상태</th>
                        <th className="!text-right">수량</th>
                        <th className="!text-right">단가</th>
                        <th>주문상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.sample_valid_rows.map((r) => (
                        <tr key={r.row_number}>
                          <td className="!text-right tabular-nums">{r.row_number}</td>
                          <td className="font-mono text-xs">{r.external_order_id}</td>
                          <td className="tabular-nums text-muted">
                            {r.ordered_at
                              ? new Date(r.ordered_at).toLocaleString("ko-KR")
                              : "-"}
                          </td>
                          <td className="font-semibold text-ink">
                            {r.raw_product_name}
                          </td>
                          <td>
                            {r.mapping_status === "MAPPED" ? (
                              <span className="chip chip-ok">연결됨</span>
                            ) : (
                              <span className="chip chip-warn">미매핑</span>
                            )}
                          </td>
                          <td className="!text-right tabular-nums">{r.quantity}</td>
                          <td className="!text-right tabular-nums">
                            {Number(r.unit_price).toLocaleString("ko-KR")}원
                          </td>
                          <td>
                            {r.status === "CANCELLED" ? (
                              <span className="chip chip-danger">
                                취소/환불 (집계제외)
                              </span>
                            ) : (
                              <span className="chip chip-ok">정상완료</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 미매핑 외부 상품명 → 내부 메뉴 매핑 도구 */}
        <div className="rounded-2xl bg-ground p-5 space-y-3">
          <h3 className="text-sm font-extrabold text-ink">
            POS/CSV 외부 상품명 ↔ 내부 메뉴 연결 관리
          </h3>

          {allUnmapped.length === 0 ? (
            <p className="text-xs font-medium text-muted">
              현재 미매핑된 외부 상품명이 없습니다.
            </p>
          ) : (
            <div className="space-y-2">
              {allUnmapped.map((extName) => {
                const selectedMenuId =
                  selectedMenuByExtName[extName] ?? activeMenus[0]?.id ?? "";
                return (
                  <div
                    key={extName}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="chip chip-warn">미매핑 외부 상품명</span>
                      <strong className="text-ink">{extName}</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`${extName} 연결 메뉴`}
                        value={selectedMenuId}
                        onChange={(e) =>
                          setSelectedMenuByExtName((prev) => ({
                            ...prev,
                            [extName]: e.target.value,
                          }))
                        }
                        className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-ink"
                      >
                        {activeMenus.length === 0 ? (
                          <option value="">먼저 메뉴를 등록하세요</option>
                        ) : (
                          activeMenus.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={!selectedMenuId || upsertMappingMutation.isPending}
                        onClick={() =>
                          upsertMappingMutation.mutate({
                            externalName: extName,
                            menuItemId: selectedMenuId,
                          })
                        }
                        className="pill pill-sm pill-primary disabled:opacity-50"
                      >
                        이 메뉴에 연결
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(mappingsQuery.data ?? []).length > 0 && (
            <div className="pt-2">
              <div className="mb-1.5 text-xs font-semibold text-muted">
                등록된 상품명 매핑 규칙 ({mappingsQuery.data?.length}건)
              </div>
              <div className="flex flex-wrap gap-2">
                {(mappingsQuery.data ?? []).map((mp) => (
                  <span
                    key={mp.id}
                    className="chip chip-idle"
                  >
                    <strong className="text-ink">{mp.external_product_name}</strong> → {mp.menu_name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 매장 기본정보 수정 (터치 요일·시간 선택) */}
      <section className="card">
        <div className="card-head flex-wrap gap-2">
          <h2>매장 기본정보 · 영업일/시간 설정</h2>
          <button
            type="button"
            onClick={() => updateStoreMutation.mutate()}
            disabled={updateStoreMutation.isPending}
            className="pill pill-primary disabled:opacity-50"
          >
            {updateStoreMutation.isPending ? "저장 중..." : "매장 정보 저장"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="settings-f8" className="mb-1.5 block text-xs font-bold text-muted">
              매장명
            </label>
            <input
              id="settings-f8"
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full rounded-xl bg-ground px-3.5 py-2.5 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-bold text-muted">
                영업일 (터치 토글)
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setBusinessDays("화,수,목,금,토,일")}
                  className="pill pill-sm pill-soft"
                >
                  월휴무
                </button>
                <button
                  type="button"
                  onClick={() => setBusinessDays("월,화,수,목,금,토,일")}
                  className="pill pill-sm pill-soft"
                >
                  매일
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {ALL_DAYS.map((day) => {
                const currentDays = businessDays
                  .split(",")
                  .map((d) => d.trim())
                  .filter(Boolean);
                const active = currentDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = active
                        ? currentDays.filter((d) => d !== day)
                        : [...currentDays, day];
                      const ordered = ALL_DAYS.filter((d) => next.includes(d));
                      setBusinessDays(ordered.join(","));
                    }}
                    className="pill pill-sm pill-soft h-10 !px-0 justify-center"
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="settings-f9" className="mb-1.5 block text-xs font-bold text-muted">
              운영시간 ({openingHours})
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                id="settings-f9"
                value={openingHours.split("-")[0] || "11:30"}
                onChange={(e) => {
                  const closePart = openingHours.split("-")[1] || "22:00";
                  setOpeningHours(`${e.target.value}-${closePart}`);
                }}
                className="rounded-xl bg-ground px-3 py-2.5 text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              >
                {OPEN_TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    오픈 {t}
                  </option>
                ))}
              </select>
              <select
                aria-label="마감 시간"
                value={openingHours.split("-")[1] || "22:00"}
                onChange={(e) => {
                  const openPart = openingHours.split("-")[0] || "11:30";
                  setOpeningHours(`${openPart}-${e.target.value}`);
                }}
                className="rounded-xl bg-ground px-3 py-2.5 text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
              >
                {CLOSE_TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    마감 {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* 테이블 구성 관리 */}
      <section className="card">
        <div className="card-head flex-wrap gap-2">
          <h2>테이블 · 좌석 구성</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="새 테이블명"
              type="text"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              placeholder="새 테이블명 (비우면 자동)"
              className="rounded-xl bg-ground px-3 py-2 text-xs font-semibold text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-300"
            />
            <input
              aria-label="새 테이블 좌석 수"
              type="number"
              min={1}
              max={20}
              value={newTableSeats}
              onChange={(e) => setNewTableSeats(e.target.value)}
              className="w-16 rounded-xl bg-ground px-2.5 py-2 text-xs font-semibold tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-accent-300"
            />
            <span className="text-xs font-medium text-muted">석</span>
            <button
              type="button"
              onClick={() => addTableMutation.mutate()}
              className="pill pill-sm pill-primary"
            >
              + 테이블 추가
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>테이블명</th>
                <th>좌석 수</th>
                <th className="!text-right">배치 좌표 (열, 행)</th>
                <th>상태</th>
                <th className="!text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {(tablesQuery.data ?? []).map((t) => (
                <tr
                  key={t.id}
                  className={t.is_active ? "" : "opacity-60"}
                >
                  <td className="font-semibold text-ink">
                    {t.name}
                  </td>
                  <td>
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          patchTableMutation.mutate({
                            tableId: t.id,
                            payload: { seats: Math.max(1, t.seats - 1) },
                          })
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-ground font-bold text-ink hover:bg-accent-50"
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-semibold tabular-nums text-ink">{t.seats}석</span>
                      <button
                        type="button"
                        onClick={() =>
                          patchTableMutation.mutate({
                            tableId: t.id,
                            payload: { seats: Math.min(20, t.seats + 1) },
                          })
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-ground font-bold text-ink hover:bg-accent-50"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="!text-right tabular-nums text-muted">
                    ({t.grid_x}, {t.grid_y})
                  </td>
                  <td>
                    <span className={`chip ${t.is_active ? "chip-ok" : "chip-idle"}`}>
                      {t.is_active ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="!text-right">
                    <button
                      type="button"
                      onClick={() =>
                        patchTableMutation.mutate({
                          tableId: t.id,
                          payload: { is_active: !t.is_active },
                        })
                      }
                      className="pill pill-sm pill-soft"
                    >
                      {t.is_active ? "비활성화" : "재활성화"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
