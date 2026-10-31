import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { AppLink as Link } from "../components/AppLink";
import { withStore } from "../lib/navigation";
import { createStore, fetchStores, fetchTables, fetchVisitSummary } from "../api/stores";
import { fetchIntegrationStatus } from "../api/imports";
import { AnalyticsPage } from "../pages/AnalyticsPage";
import { HomePage } from "../pages/HomePage";
import { IngredientManagementPage } from "../pages/IngredientManagementPage";
import { InventoryPage } from "../pages/InventoryPage";
import { MenuManagementPage } from "../pages/MenuManagementPage";
import { SettingsPage } from "../pages/SettingsPage";
import type { Store } from "../types";

export const ALL_DAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
export const OPEN_TIME_OPTIONS = [
  "09:00",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "17:00",
  "18:00",
];
export const CLOSE_TIME_OPTIONS = [
  "20:00",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
  "23:00",
  "24:00",
  "01:00",
];

function StoreBootstrapWizard({ onCreated }: { onCreated: (store: Store) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>([
    "화",
    "수",
    "목",
    "금",
    "토",
    "일",
  ]);
  const [openTime, setOpenTime] = useState("11:30");
  const [closeTime, setCloseTime] = useState("22:00");
  const [tableCount, setTableCount] = useState(6);
  const [defaultSeats, setDefaultSeats] = useState(4);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(day: string) {
    setSelectedDays((prev) => {
      if (prev.includes(day)) {
        return prev.filter((d) => d !== day);
      }
      const next = [...prev, day];
      return ALL_DAYS.filter((d) => next.includes(d));
    });
  }

  const businessDaysStr = selectedDays.join(",");
  const openingHoursStr = `${openTime}-${closeTime}`;

  const mutation = useMutation({
    mutationFn: () =>
      createStore({
        name: name.trim(),
        business_days: businessDaysStr || "연중무휴",
        opening_hours: openingHoursStr,
        initial_table_count: tableCount,
        default_seats: defaultSeats,
      }),
    onSuccess: (store) => onCreated(store),
    onError: (err: Error) => setError(err.message || "매장 생성에 실패했습니다."),
  });

  function handleNextStep(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("매장명을 입력해 주세요.");
      return;
    }
    if (selectedDays.length === 0) {
      setError("영업일을 최소 1일 이상 터치하여 선택해 주세요.");
      return;
    }
    setError(null);
    setStep(2);
  }

  function handleCreateStore(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="mx-auto mt-8 max-w-xl rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="text-2xl font-bold text-gray-900">새 매장 시작하기</h1>
      <p className="mt-1 text-sm font-medium text-gray-700">
        {step === 1 ? "1단계 · 매장명과 영업 시간" : "2단계 · 테이블 구성"} ({step}/2)
      </p>
      <p className="mt-1 text-sm text-gray-600">
        요일과 운영시간, 테이블 수를 터치로 간편하게 선택하세요. 생성 후 설정 화면에서도 언제든
        변경할 수 있습니다.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      {step === 1 ? (
        <form onSubmit={handleNextStep} className="mt-5 space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-gray-700">
              매장명 <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 비스트로 서울"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base font-medium focus:border-accent-600 focus:outline-none"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-gray-800">
                영업 요일 선택 (터치 토글)
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedDays(["화", "수", "목", "금", "토", "일"])}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-100"
                >
                  월요일 휴무
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDays([...ALL_DAYS])}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-100"
                >
                  매일 영업
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDays(["월", "화", "수", "목", "금"])}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-100"
                >
                  평일만
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-2">
              {ALL_DAYS.map((day) => {
                const active = selectedDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`flex h-12 items-center justify-center rounded-lg border text-base font-bold transition ${
                      active
                        ? "border-accent-600 bg-accent-50 text-accent-800"
                        : "border-gray-300 bg-white text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-gray-600">
              선택됨:{" "}
              <span className="font-bold text-gray-900">
                {businessDaysStr || "선택 안 됨"}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <label className="block text-xs font-bold text-gray-800">
              운영 시간 (터치 선택)
            </label>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-gray-600">오픈 시간</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {OPEN_TIME_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setOpenTime(t)}
                      className={`rounded-lg border py-2 text-xs font-bold ${
                        openTime === t
                          ? "border-accent-600 bg-accent-50 text-accent-800"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-gray-600">마감 시간</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {CLOSE_TIME_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCloseTime(t)}
                      className={`rounded-lg border py-2 text-xs font-bold ${
                        closeTime === t
                          ? "border-accent-600 bg-accent-50 text-accent-800"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2.5 text-xs text-gray-600">
              설정된 운영시간:{" "}
              <span className="font-bold text-gray-900">{openingHoursStr}</span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-accent-600 py-3.5 text-base font-bold text-white hover:bg-accent-700"
          >
            다음 단계 (테이블 구성) →
          </button>
        </form>
      ) : (
        <form onSubmit={handleCreateStore} className="mt-5 space-y-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <label className="block text-sm font-bold text-gray-800">
              매장 홀 테이블 수 (터치 조절)
            </label>
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                onClick={() => setTableCount((c) => Math.max(1, c - 1))}
                className="flex h-12 w-14 items-center justify-center rounded-lg border border-gray-300 bg-white text-xl font-bold text-gray-800 active:bg-gray-100"
              >
                -
              </button>
              <span className="min-w-[110px] text-center text-2xl font-bold text-gray-900">
                {tableCount}개 테이블
              </span>
              <button
                type="button"
                onClick={() => setTableCount((c) => Math.min(30, c + 1))}
                className="flex h-12 w-14 items-center justify-center rounded-lg border border-gray-300 bg-white text-xl font-bold text-gray-800 active:bg-gray-100"
              >
                +
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[4, 6, 8, 10, 12].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setTableCount(cnt)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                    tableCount === cnt
                      ? "border-accent-600 bg-accent-50 text-accent-800"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  {cnt}개
                </button>
              ))}
            </div>

            <label className="mt-5 block text-sm font-bold text-gray-800">
              테이블당 기본 좌석 수 (생성 후 개별 변경 가능)
            </label>
            <div className="mt-2.5 grid grid-cols-3 gap-2.5">
              {[2, 4, 6].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDefaultSeats(s)}
                  className={`rounded-lg border py-3 text-sm font-bold ${
                    defaultSeats === s
                      ? "border-accent-600 bg-accent-50 text-accent-800"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  기본 {s}인석
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="w-1/3 rounded-lg border border-gray-300 py-3.5 text-sm font-bold text-gray-700 hover:bg-gray-100"
            >
              ← 이전
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-2/3 rounded-lg bg-accent-600 py-3.5 text-base font-bold text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {mutation.isPending ? "생성 중..." : "매장 및 테이블 생성 완료"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ShellLayout({ store }: { store: Store }) {
  const location = useLocation();
  // 평상시 홀 영업 중에는 HOME 화면 공간 극대화를 위해 사이드 메뉴를 기본 접힘 상태로 시작
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [metaverseMode, setMetaverseMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("restaurant_ax_metaverse_mode") !== "false";
    } catch {
      return true;
    }
  });

  function handleSetMetaverseMode(next: boolean) {
    setMetaverseMode(next);
    try {
      localStorage.setItem("restaurant_ax_metaverse_mode", String(next));
    } catch {
      // ignore storage errors
    }
  }

  const integrationQuery = useQuery({
    queryKey: ["integration-status", store.id],
    queryFn: () => fetchIntegrationStatus(store.id),
  });
  const visitSummaryQuery = useQuery({
    queryKey: ["visit-summary", store.id],
    queryFn: () => fetchVisitSummary(store.id),
  });
  const tablesQuery = useQuery({
    queryKey: ["tables", store.id],
    queryFn: () => fetchTables(store.id, false),
  });

  const integration = integrationQuery.data;
  const visitSummary = visitSummaryQuery.data;
  const activeTablesCount = tablesQuery.data?.length ?? 0;

  const navItems = [
    { to: "/home", label: "홈 · 홀 테이블" },
    { to: "/menus", label: "메뉴 관리" },
    { to: "/ingredients", label: "식자재 · 레시피" },
    { to: "/inventory", label: "입고 · 재고" },
    { to: "/analytics", label: "분석 대시보드" },
    { to: "/settings", label: "설정 (POS·매장·CSV)" },
  ];

  const currentNav = navItems.find((item) => location.pathname.startsWith(item.to));

  return (
    <div className="min-h-[var(--app-viewport-height)] bg-ground text-gray-900">
      {/* 태블릿 친화형 컴팩트 상단 상태 & 네비게이션 바 (U-08) */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-2">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {/* 좌측: 사이드 메뉴 토글 + 매장 정보 + 도트 홀 스위치 */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="사이드 메뉴 토글"
              aria-expanded={sidebarOpen}
              className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition ${
                sidebarOpen
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
              }`}
            >
              {sidebarOpen ? "메뉴 닫기" : "메뉴"}
            </button>

            <div className="flex items-baseline gap-2">
              <Link to="/home" className="text-base font-bold text-gray-900 hover:text-accent-700">
                {store.name}
              </Link>
              {location.pathname === "/home" && (
                <h1 className="text-base font-semibold text-gray-500">/ 홀 테이블</h1>
              )}
              <span className="hidden text-[12px] text-gray-600 sm:inline">
                {store.business_days ?? "영업일 미설정"} · {store.opening_hours ?? "시간 미설정"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">2D 도트 홀</span>
              <button
                type="button"
                role="switch"
                aria-checked={metaverseMode}
                aria-label="2D 도트 홀 모드 전환"
                onClick={() => handleSetMetaverseMode(!metaverseMode)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  metaverseMode ? "bg-gray-900" : "bg-gray-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white ring-0 transition duration-200 ease-in-out ${
                    metaverseMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="w-7 text-[12px] font-medium text-gray-600">
                {metaverseMode ? "ON" : "OFF"}
              </span>
            </div>

            {currentNav && location.pathname !== "/home" && (
              <Link
                to="/home"
                className="text-sm font-medium text-accent-700 hover:text-accent-900"
              >
                ← 홀 테이블로
              </Link>
            )}
          </div>

          {/* 우측: 축소된 핵심 지표 요약 (U-08) */}
          <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-gray-600">홀 착석</dt>
              <dd className="font-semibold text-gray-900">
                {visitSummary?.active_table_count ?? 0}/{activeTablesCount}테이블 ·{" "}
                {visitSummary?.active_guest_count ?? 0}명
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-gray-600">누적 방문</dt>
              <dd className="font-semibold text-gray-900">
                {visitSummary?.total_visit_count ?? 0}팀 · {visitSummary?.total_guest_count ?? 0}명
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-gray-600">순매출</dt>
              <dd className="font-semibold text-gray-900">
                {integration && integration.total_orders_count > 0
                  ? `${Number(integration.net_sales_amount).toLocaleString("ko-KR")}원 (${integration.total_orders_count}건)`
                  : "0원"}
              </dd>
            </div>
            <Link
              to="/settings"
              className={`hidden rounded px-2 py-0.5 text-[12px] font-medium xl:inline-block ${
                integration?.connection_status === "READY_CSV"
                  ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  : "bg-amber-50 text-amber-900"
              }`}
            >
              {integration?.mode === "CSV_UPLOAD"
                ? "CSV/수동 모드"
                : `${integration?.mode ?? "POS"} (미검증)`}
            </Link>
          </dl>
        </div>
      </header>

      {/* 본문 레이아웃: 사이드바 열림 시 좌측 고정 레일, 닫힘 시 태블릿 전체 폭 100% 활용 */}
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <div
          className={
            sidebarOpen
              ? "grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]"
              : "grid grid-cols-1"
          }
        >
          {sidebarOpen && (
            <aside className="self-start rounded-lg border border-gray-200 bg-white p-2">
              <div className="mb-1 flex items-center justify-between px-2 pt-1">
                <span className="text-[12px] text-gray-600">화면 이동</span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="text-[12px] font-medium text-gray-600 hover:text-gray-900"
                >
                  접기
                </button>
              </div>
              <nav className="space-y-0.5">
                {navItems.map((item) => {
                  const active = location.pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        if (window.innerWidth < 1024 || item.to === "/home") {
                          setSidebarOpen(false);
                        }
                      }}
                      className={`flex min-h-11 items-center rounded-md px-3 text-sm transition ${
                        active
                          ? "bg-gray-100 font-semibold text-gray-900"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </aside>
          )}

          <main className="min-w-0">
            <Routes>
              <Route path="/" element={<Navigate to={withStore("/home", location.search)} replace />} />
              <Route
                path="/home"
                element={<HomePage store={store} metaverseMode={metaverseMode} />}
              />
              <Route path="/menus" element={<MenuManagementPage store={store} />} />
              <Route path="/ingredients" element={<IngredientManagementPage store={store} />} />
              <Route path="/inventory" element={<InventoryPage store={store} />} />
              <Route path="/analytics" element={<AnalyticsPage store={store} />} />
              <Route path="/settings" element={<SettingsPage store={store} />} />
              <Route path="*" element={<Navigate to={withStore("/home", location.search)} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <StoreApp />
    </BrowserRouter>
  );
}

function StoreApp() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const storesQuery = useQuery({
    queryKey: ["stores"],
    queryFn: fetchStores,
  });
  const storeId = params.get("store");
  const stores = storesQuery.data ?? [];
  const selectedStore = storeId ? stores.find((store) => store.id === storeId) : stores[0];

  useEffect(() => {
    if (!storeId && selectedStore) {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("store", selectedStore.id);
        return next;
      }, { replace: true });
    }
  }, [storeId, selectedStore, setParams]);

  if (storesQuery.isLoading) {
    return (
      <div className="p-10 text-center text-sm text-gray-600">
        매장 정보를 확인하는 중입니다...
      </div>
    );
  }

  if (storesQuery.isError) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-lg border border-red-300 bg-red-50 p-6 text-sm text-red-900">
        <h1 className="text-base font-bold">백엔드 API 서버에 연결할 수 없습니다</h1>
        <p className="mt-2">
          잠시 후 새로고침해 주세요. 문제가 계속되면 서비스 관리자에게 문의해 주세요.
        </p>
      </div>
    );
  }

  if (storeId && !selectedStore) {
    return <div className="p-10 text-center">주소에 지정된 매장을 찾을 수 없습니다.</div>;
  }
  if (!selectedStore) {
    return (
      <StoreBootstrapWizard
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["stores"] });
        }}
      />
    );
  }

  return <ShellLayout key={selectedStore.id} store={selectedStore} />;
}
