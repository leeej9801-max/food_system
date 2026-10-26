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
  { title: string; badge: string; desc: string }
> = {
  CSV_UPLOAD: {
    title: "모드 C · CSV/Excel 파일 업로드 (기본 보장)",
    badge: "READY_CSV · 즉시 사용 가능",
    desc: "POS 매출 내보내기 파일(CSV)을 업로드하여 미리보기·컬럼 매핑·중복 검사 후 안전하게 판매량을 반영합니다. (실시간 아님)",
  },
  TOSS_OPEN_API: {
    title: "모드 A · 토스플레이스 Open API",
    badge: "UNVERIFIED · 실제 자격증명 미검증",
    desc: "토스플레이스 파트너 API 키 기반 수집 모드입니다. 현재 실제 파트너 자격증명 미검증 상태이므로 완료로 표시하지 않습니다.",
  },
  TOSS_PLUGIN: {
    title: "모드 B · 토스 프론트 플러그인 SDK",
    badge: "UNVERIFIED · 실제 단말 미검증",
    desc: "매장 토스 프론트 단말 내부 플러그인 브리지 모드입니다. 실제 장비 검증 전까지 모드 C(CSV)를 함께 제공합니다.",
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

  // S01 CSV Upload & Mapping state
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
            화면 S01 & S07 · REQ-001 / REQ-003 / REQ-004 / REQ-011
          </span>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            POS 데이터 연동(S01) 및 매장·테이블 환경설정(S07)
          </h1>
          <p className="text-sm text-slate-600">
            POS 연동 모드(A/B/C) 선택, 판매 CSV 파일 업로드·미리보기·메뉴 매핑과 매장 테이블 구성을 관리합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={() => seedDemoMutation.mutate()}
          disabled={seedDemoMutation.isPending}
          className="rounded-xl border border-blue-300 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-900 hover:bg-blue-100 disabled:opacity-50"
        >
          {seedDemoMutation.isPending
            ? "프로토타입 데이터 준비 중..."
            : "양식당 프로토타입 마스터(식자재·메뉴·레시피·단가) 원클릭 세팅"}
        </button>
      </div>

      {banner && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
            banner.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs underline"
          >
            닫기
          </button>
        </div>
      )}

      {/* 화면 S01: POS 연결 모드 선택 및 CSV 파일 수집 */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-900">
              화면 S01 · POS 연동 및 데이터 수집
            </span>
            <h2 className="mt-1 text-base font-bold text-slate-900">
              데이터 수집 어댑터 모드 (A / B / C)
            </h2>
          </div>
          {integration && (
            <div className="text-right text-xs text-slate-600">
              <div>
                현재 상태:{" "}
                <strong className="text-slate-900">
                  {integration.connection_status === "READY_CSV"
                    ? "CSV 파일 수집 준비됨 (비실시간)"
                    : "미검증 (UNVERIFIED)"}
                </strong>
              </div>
              <div>
                누적 완료 주문: <strong>{integration.total_orders_count}건</strong> · 순매출:{" "}
                <strong>
                  {Number(integration.net_sales_amount).toLocaleString("ko-KR")}원
                </strong>
              </div>
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
                  onClick={() => updateModeMutation.mutate(m)}
                  className={`flex flex-col justify-between rounded-xl border-2 p-4 text-left transition ${
                    selected
                      ? "border-blue-600 bg-blue-50/60"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-900">
                        {info.title}
                      </span>
                    </div>
                    <span
                      className={`mt-1.5 inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${
                        m === "CSV_UPLOAD"
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {info.badge}
                    </span>
                    <p className="mt-2 text-xs text-slate-600">{info.desc}</p>
                  </div>
                  <div className="mt-3 text-xs font-semibold text-blue-700">
                    {selected ? "● 현재 선택된 모드" : "이 모드로 전환 →"}
                  </div>
                </button>
              );
            }
          )}
        </div>

        {/* CSV 업로드 및 컬럼 매핑 영역 */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                판매 데이터 CSV 업로드 · 미리보기 · 확정 반영 (REQ-003, REQ-004)
              </h3>
              <p className="text-xs text-slate-600">
                취소/환불(`CANCELLED`) 행은 순매출 및 예상 재고 차감에서 자동 제외됩니다. 동일 파일 재업로드 시 중복 경고를 표시하며 주문번호 기준으로 멱등 반영됩니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadSampleCsvMutation.mutate()}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
              >
                양식당 샘플 CSV 불러오기
              </button>
              <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                주문번호 컬럼
              </label>
              <input
                type="text"
                value={orderIdCol}
                onChange={(e) => setOrderIdCol(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                주문시각 컬럼
              </label>
              <input
                type="text"
                value={orderedAtCol}
                onChange={(e) => setOrderedAtCol(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                상품명 컬럼
              </label>
              <input
                type="text"
                value={productNameCol}
                onChange={(e) => setProductNameCol(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                수량 컬럼
              </label>
              <input
                type="text"
                value={quantityCol}
                onChange={(e) => setQuantityCol(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                단가 컬럼
              </label>
              <input
                type="text"
                value={unitPriceCol}
                onChange={(e) => setUnitPriceCol(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600">
                상태 컬럼
              </label>
              <input
                type="text"
                value={statusCol}
                onChange={(e) => setStatusCol(e.target.value)}
                className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              CSV 원문 ({csvFileName})
            </label>
            <textarea
              rows={5}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setPreviewResult(null);
              }}
              placeholder="order_id,ordered_at,menu_name,quantity,unit_price,status 형식의 CSV 내용을 붙여넣거나 파일을 선택하세요."
              className="w-full rounded-lg border border-slate-300 bg-white p-2.5 font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={!csvText.trim() || previewCsvMutation.isPending}
              onClick={() => previewCsvMutation.mutate()}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
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
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {commitCsvMutation.isPending
                  ? "반영 중..."
                  : `2단계: 유효 ${previewResult.rows_valid}행 판매 데이터 확정 반영`}
              </button>
            )}
          </div>

          {/* 미리보기 결과 요약 및 상세 */}
          {previewResult && (
            <div className="rounded-lg border border-slate-300 bg-white p-4 space-y-3">
              {previewResult.duplicate_file_warning && (
                <div className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  ⚠️ 이전에 이미 반영(COMMITTED)된 적이 있는 동일한 CSV 파일 해시입니다. 다시 반영하더라도 주문번호 기준으로 덮어쓰므로 매출이 중복 합산되지 않습니다.
                </div>
              )}

              <div className="flex flex-wrap gap-4 text-xs">
                <span>
                  총 행수: <strong>{previewResult.rows_total}</strong>
                </span>
                <span className="text-emerald-700">
                  유효 행: <strong>{previewResult.rows_valid}</strong>
                </span>
                <span className="text-red-700">
                  오류 행: <strong>{previewResult.rows_error}</strong>
                </span>
                <span className="text-amber-700">
                  미매핑 행: <strong>{previewResult.rows_unmapped}</strong>
                </span>
              </div>

              {previewResult.errors.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-900">
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
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5">행</th>
                        <th className="px-2 py-1.5">주문번호</th>
                        <th className="px-2 py-1.5">주문시각</th>
                        <th className="px-2 py-1.5">상품명 (POS/CSV)</th>
                        <th className="px-2 py-1.5">매핑 상태</th>
                        <th className="px-2 py-1.5">수량</th>
                        <th className="px-2 py-1.5">단가</th>
                        <th className="px-2 py-1.5">주문상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {previewResult.sample_valid_rows.map((r) => (
                        <tr key={r.row_number}>
                          <td className="px-2 py-1.5 font-mono">{r.row_number}</td>
                          <td className="px-2 py-1.5 font-mono">{r.external_order_id}</td>
                          <td className="px-2 py-1.5 font-mono">
                            {r.ordered_at
                              ? new Date(r.ordered_at).toLocaleString("ko-KR")
                              : "-"}
                          </td>
                          <td className="px-2 py-1.5 font-semibold">
                            {r.raw_product_name}
                          </td>
                          <td className="px-2 py-1.5">
                            {r.mapping_status === "MAPPED" ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-900">
                                연결됨
                              </span>
                            ) : (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                                미매핑
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">{r.quantity}</td>
                          <td className="px-2 py-1.5">
                            {Number(r.unit_price).toLocaleString("ko-KR")}원
                          </td>
                          <td className="px-2 py-1.5">
                            {r.status === "CANCELLED" ? (
                              <span className="text-red-600 font-semibold">
                                취소/환불 (집계제외)
                              </span>
                            ) : (
                              "정상완료"
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              POS/CSV 외부 상품명 ↔ 내부 메뉴 연결 관리 (REQ-011)
            </h3>
            <p className="text-xs text-slate-600">
              CSV 또는 POS의 상품명이 메뉴 관리(S03)의 이름과 다를 경우 연결해 주세요. 연결 즉시 기존에 수집된 미매핑 판매 항목도 소급 갱신됩니다.
            </p>
          </div>

          {allUnmapped.length === 0 ? (
            <p className="text-xs text-emerald-700 font-medium">
              ✓ 현재 미매핑된 외부 상품명이 없습니다.
            </p>
          ) : (
            <div className="space-y-2">
              {allUnmapped.map((extName) => {
                const selectedMenuId =
                  selectedMenuByExtName[extName] ?? activeMenus[0]?.id ?? "";
                return (
                  <div
                    key={extName}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-amber-900">
                        미매핑 외부 상품명:
                      </span>{" "}
                      <strong className="text-slate-900">{extName}</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedMenuId}
                        onChange={(e) =>
                          setSelectedMenuByExtName((prev) => ({
                            ...prev,
                            [extName]: e.target.value,
                          }))
                        }
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
                      >
                        {activeMenus.length === 0 ? (
                          <option value="">먼저 메뉴(S03)를 등록하세요</option>
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
                        className="rounded bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
              <div className="text-xs font-semibold text-slate-600 mb-1">
                등록된 상품명 매핑 규칙 ({mappingsQuery.data?.length}건)
              </div>
              <div className="flex flex-wrap gap-2">
                {(mappingsQuery.data ?? []).map((mp) => (
                  <span
                    key={mp.id}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                  >
                    <strong>{mp.external_product_name}</strong> → {mp.menu_name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 매장 기본정보 수정 (터치 요일·시간 선택) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              매장 기본정보 · 영업일/시간 설정 (S07)
            </h2>
            <p className="text-xs text-slate-500">
              요일과 시간을 터치하여 변경한 뒤 저장을 누르면 상단 상태바에 즉시 반영됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => updateStoreMutation.mutate()}
            disabled={updateStoreMutation.isPending}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700"
          >
            {updateStoreMutation.isPending ? "저장 중..." : "매장 정보 저장"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              매장명
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">
                영업일 (터치 토글)
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setBusinessDays("화,수,목,금,토,일")}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                >
                  월휴무
                </button>
                <button
                  type="button"
                  onClick={() => setBusinessDays("월,화,수,목,금,토,일")}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
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
                    onClick={() => {
                      const next = active
                        ? currentDays.filter((d) => d !== day)
                        : [...currentDays, day];
                      const ordered = ALL_DAYS.filter((d) => next.includes(d));
                      setBusinessDays(ordered.join(","));
                    }}
                    className={`h-10 rounded-xl border text-xs font-extrabold transition ${
                      active
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-slate-50 text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              운영시간 ({openingHours})
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={openingHours.split("-")[0] || "11:30"}
                onChange={(e) => {
                  const closePart = openingHours.split("-")[1] || "22:00";
                  setOpeningHours(`${e.target.value}-${closePart}`);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-800"
              >
                {OPEN_TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    오픈 {t}
                  </option>
                ))}
              </select>
              <select
                value={openingHours.split("-")[1] || "22:00"}
                onChange={(e) => {
                  const openPart = openingHours.split("-")[0] || "11:30";
                  setOpeningHours(`${openPart}-${e.target.value}`);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-800"
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
      </div>

      {/* 테이블 구성 관리 */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              테이블 · 좌석 구성 (S07)
            </h2>
            <p className="text-xs text-slate-500">
              테이블을 비활성화해도 과거 방문 기록은 삭제되지 않습니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              placeholder="새 테이블명 (비우면 자동)"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
            <input
              type="number"
              min={1}
              max={20}
              value={newTableSeats}
              onChange={(e) => setNewTableSeats(e.target.value)}
              className="w-16 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
            <span className="text-xs text-slate-600">석</span>
            <button
              type="button"
              onClick={() => addTableMutation.mutate()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              + 테이블 추가
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2">테이블명</th>
                <th className="px-3 py-2">좌석 수</th>
                <th className="px-3 py-2">배치 좌표 (열, 행)</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(tablesQuery.data ?? []).map((t) => (
                <tr
                  key={t.id}
                  className={t.is_active ? "" : "bg-slate-50 text-slate-400"}
                >
                  <td className="px-3 py-2 font-semibold text-slate-900">
                    {t.name}
                  </td>
                  <td className="px-3 py-2">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          patchTableMutation.mutate({
                            tableId: t.id,
                            payload: { seats: Math.max(1, t.seats - 1) },
                          })
                        }
                        className="rounded border border-slate-300 px-1.5 py-0.5"
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-mono">{t.seats}석</span>
                      <button
                        type="button"
                        onClick={() =>
                          patchTableMutation.mutate({
                            tableId: t.id,
                            payload: { seats: Math.min(20, t.seats + 1) },
                          })
                        }
                        className="rounded border border-slate-300 px-1.5 py-0.5"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    ({t.grid_x}, {t.grid_y})
                  </td>
                  <td className="px-3 py-2">
                    {t.is_active ? "● 활성" : "○ 비활성"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        patchTableMutation.mutate({
                          tableId: t.id,
                          payload: { is_active: !t.is_active },
                        })
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {t.is_active ? "비활성화" : "재활성화"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
