import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { AppLink as Link } from "../components/AppLink";
import { withStore } from "../lib/navigation";
import { createStore, fetchStores, fetchTables, fetchVisitSummary } from "../api/stores";
import { fetchIntegrationStatus } from "../api/imports";
import { AnalyticsPage } from "../pages/AnalyticsPage";
import { PnlPage } from "../pages/PnlPage";
import { HomePage } from "../pages/HomePage";
import { InventoryPage } from "../pages/InventoryPage";
import { SettingsPage } from "../pages/SettingsPage";
import type { Store } from "../types";

// astryx 시험 화면이라 따로 불러온다: 다른 화면 번들에 astryx가 섞이지 않게
const IngredientManagementPage = lazy(() =>
  import("../pages/IngredientManagementPage").then((m) => ({
    default: m.IngredientManagementPage,
  })),
);
const MenuManagementPage = lazy(() =>
  import("../pages/MenuManagementPage").then((m) => ({ default: m.MenuManagementPage })),
);

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
    <div className="card mx-auto mt-8 max-w-xl">
      <div className="card-head">
        <h1 className="text-xl font-extrabold text-ink">새 매장 시작하기</h1>
        <span className="chip chip-idle">
          {step === 1 ? "1단계 · 매장명과 영업 시간" : "2단계 · 테이블 구성"} ({step}/2)
        </span>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-900">
          {error}
        </div>
      )}

      {step === 1 ? (
        <form onSubmit={handleNextStep} className="mt-4 space-y-5">
          <div>
            <label htmlFor="app-f1" className="mb-1.5 block text-xs font-bold text-muted">
              매장명 <span className="text-red-600">*</span>
            </label>
            <input
              id="app-f1"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 비스트로 서울"
              className="w-full rounded-xl bg-ground px-4 py-3 text-base font-semibold text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-300"
            />
          </div>

          <div className="rounded-2xl bg-ground p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-ink">
                영업 요일 선택 (터치 토글)
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedDays(["화", "수", "목", "금", "토", "일"])}
                  className="pill pill-sm pill-soft !bg-white"
                >
                  월요일 휴무
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDays([...ALL_DAYS])}
                  className="pill pill-sm pill-soft !bg-white"
                >
                  매일 영업
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDays(["월", "화", "수", "목", "금"])}
                  className="pill pill-sm pill-soft !bg-white"
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
                    aria-pressed={active}
                    onClick={() => toggleDay(day)}
                    className={`pill pill-soft flex h-12 items-center justify-center !px-0 text-base ${
                      active ? "" : "!bg-white"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-muted">
              선택됨:{" "}
              <span className="font-bold text-ink">
                {businessDaysStr || "선택 안 됨"}
              </span>
            </div>
          </div>

          <div className="rounded-2xl bg-ground p-4">
            <p className="block text-xs font-bold text-ink">
              운영 시간 (터치 선택)
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-muted">오픈 시간</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {OPEN_TIME_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={openTime === t}
                      onClick={() => setOpenTime(t)}
                      className={`pill pill-sm pill-soft justify-center !px-1 tabular-nums ${
                        openTime === t ? "" : "!bg-white"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-muted">마감 시간</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {CLOSE_TIME_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={closeTime === t}
                      onClick={() => setCloseTime(t)}
                      className={`pill pill-sm pill-soft justify-center !px-1 tabular-nums ${
                        closeTime === t ? "" : "!bg-white"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2.5 text-xs text-muted">
              설정된 운영시간:{" "}
              <span className="font-bold tabular-nums text-ink">{openingHoursStr}</span>
            </div>
          </div>

          <button
            type="submit"
            className="pill pill-primary w-full justify-center py-3.5 text-base"
          >
            다음 단계 (테이블 구성) →
          </button>
        </form>
      ) : (
        <form onSubmit={handleCreateStore} className="mt-4 space-y-5">
          <div className="rounded-2xl bg-ground p-5">
            <p className="block text-sm font-bold text-ink">
              매장 홀 테이블 수 (터치 조절)
            </p>
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                onClick={() => setTableCount((c) => Math.max(1, c - 1))}
                className="flex h-12 w-14 items-center justify-center rounded-full bg-white text-xl font-bold text-ink hover:bg-accent-50"
              >
                -
              </button>
              <span className="min-w-[110px] text-center text-2xl font-bold tabular-nums text-ink">
                {tableCount}개 테이블
              </span>
              <button
                type="button"
                onClick={() => setTableCount((c) => Math.min(30, c + 1))}
                className="flex h-12 w-14 items-center justify-center rounded-full bg-white text-xl font-bold text-ink hover:bg-accent-50"
              >
                +
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[4, 6, 8, 10, 12].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  aria-pressed={tableCount === cnt}
                  onClick={() => setTableCount(cnt)}
                  className={`pill pill-sm pill-soft tabular-nums ${
                    tableCount === cnt ? "" : "!bg-white"
                  }`}
                >
                  {cnt}개
                </button>
              ))}
            </div>

            <p className="mt-5 block text-sm font-bold text-ink">
              테이블당 기본 좌석 수 (생성 후 개별 변경 가능)
            </p>
            <div className="mt-2.5 grid grid-cols-3 gap-2.5">
              {[2, 4, 6].map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={defaultSeats === s}
                  onClick={() => setDefaultSeats(s)}
                  className={`pill pill-soft justify-center py-3 text-sm tabular-nums ${
                    defaultSeats === s ? "" : "!bg-white"
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
              className="pill pill-soft w-1/3 justify-center py-3.5 text-sm"
            >
              ← 이전
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="pill pill-primary w-2/3 justify-center py-3.5 text-base disabled:opacity-50"
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
  // 넓은 화면은 사이드 메뉴를 펼친 채, 태블릿 세로 이하는 접은 채 시작한다
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
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
    { to: "/home", label: "홀", icon: "M3 10.5 12 4l9 6.5V20H3z M9.5 20v-5h5v5" },
    { to: "/menus", label: "메뉴 관리", icon: "M7 3v8 M4.5 3v5a2.5 2.5 0 0 0 5 0V3 M7 11v10 M17 3c-2 1.5-3 4-3 7h3v11" },
    { to: "/ingredients", label: "식자재 관리", icon: "M5 19c0-8 5-14 14-14 0 9-6 14-14 14z M5 19l7-7" },
    { to: "/inventory", label: "재고·입고", icon: "M12 3 4 7v10l8 4 8-4V7z M4 7l8 4 8-4 M12 11v10" },
    { to: "/pnl", label: "손익", icon: "M4 6h16v12H4z M4 10h16 M15 14h2" },
    { to: "/analytics", label: "분석", icon: "M4 20h16 M7 16v-5 M12 16V7 M17 16v-8" },
    { to: "/settings", label: "설정", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4 7 17 M17 7l1.4-1.4" },
  ];

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const headerRef = useRef<HTMLElement>(null);

  // 홈 기록 화면이 문서 스크롤 없이 남은 높이를 쓰도록 헤더 높이를 CSS 변수로 알린다 (U-31)
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--app-header-height", `${el.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-[var(--app-viewport-height)] bg-ground text-gray-900">
      {/* 좌측 고정 사이드 메뉴 (시안 A). 좁은 화면에서는 배경을 덮는 서랍으로 연다. */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="메뉴 닫기"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
        />
      )}
      <aside
        inert={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-40 flex w-[216px] flex-col bg-white px-5 py-8 transition-transform duration-200 lg:w-[184px] lg:px-3.5 xl:w-[216px] xl:px-5 xl:py-[35px] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link to="/home" className="mb-8 truncate px-2.5 text-[19px] font-bold tracking-tight text-ink">
          {store.name}
        </Link>
        <nav className="flex flex-col gap-1.5">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (window.innerWidth < 1024) setSidebarOpen(false);
                }}
                className={`flex min-h-12 items-center gap-3 rounded-full px-4 text-sm transition ${
                  active ? "bg-accent-600 font-semibold text-white" : "text-gray-500 hover:bg-ground"
                }`}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-5 w-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className={`transition-[padding] duration-200 ${sidebarOpen ? "lg:pl-[184px] xl:pl-[216px]" : ""}`}>
        <header ref={headerRef} className="sticky top-0 z-20 flex min-h-[68px] items-center bg-ground px-4 py-3 md:px-6 xl:px-9">
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label="사이드 메뉴 토글"
                aria-expanded={sidebarOpen}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink hover:bg-accent-50"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M4 7h16 M4 12h16 M4 17h16" />
                </svg>
              </button>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-ink">{store.name}</span>
                <span className="hidden text-[12px] text-gray-500 sm:inline">
                  {store.business_days ?? "영업일 미설정"} · {store.opening_hours ?? "시간 미설정"}
                </span>
              </div>
              {location.pathname === "/home" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">2D 도트 홀</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={metaverseMode}
                    aria-label="2D 도트 홀 모드 전환"
                    onClick={() => handleSetMetaverseMode(!metaverseMode)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      metaverseMode ? "bg-accent-600" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white ring-0 transition duration-200 ease-in-out ${
                        metaverseMode ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>

            <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-gray-500">홀 착석</dt>
                <dd className="font-semibold text-ink">
                  {visitSummary?.active_table_count ?? 0}/{activeTablesCount}테이블 ·{" "}
                  {visitSummary?.active_guest_count ?? 0}명
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-gray-500">누적 방문</dt>
                <dd className="font-semibold text-ink">
                  {visitSummary?.total_visit_count ?? 0}팀 · {visitSummary?.total_guest_count ?? 0}명
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-gray-500">순매출</dt>
                <dd className="font-semibold text-ink">
                  {integration && integration.total_orders_count > 0
                    ? `${Number(integration.net_sales_amount).toLocaleString("ko-KR")}원 (${integration.total_orders_count}건)`
                    : "0원"}
                </dd>
              </div>
              <Link
                to="/settings"
                className={`hidden rounded-full px-2.5 py-0.5 text-[12px] font-medium xl:inline-block ${
                  integration?.connection_status === "READY_CSV"
                    ? "bg-white text-gray-600 hover:bg-accent-50"
                    : "bg-amber-50 text-amber-900"
                }`}
              >
                {integration?.mode === "CSV_UPLOAD"
                  ? "CSV/수동 모드"
                  : `${integration?.mode ?? "POS"} (미검증)`}
              </Link>
              <span className="hidden text-gray-500 lg:inline">{today}</span>
            </dl>
          </div>
        </header>

        <div className="mx-auto max-w-[1600px] px-4 pt-3 pb-9 md:px-6 xl:px-9">
          <main className="min-w-0">
            <Routes>
              <Route path="/" element={<Navigate to={withStore("/home", location.search)} replace />} />
              <Route
                path="/home"
                element={<HomePage store={store} metaverseMode={metaverseMode} />}
              />
              <Route
                path="/menus"
                element={
                  <Suspense fallback={null}>
                    <MenuManagementPage store={store} />
                  </Suspense>
                }
              />
              <Route
                path="/ingredients"
                element={
                  <Suspense fallback={null}>
                    <IngredientManagementPage store={store} />
                  </Suspense>
                }
              />
              <Route path="/inventory" element={<InventoryPage store={store} />} />
              <Route path="/pnl" element={<PnlPage store={store} />} />
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
      <div className="p-10 text-center text-sm text-muted">
        매장 정보를 확인하는 중입니다...
      </div>
    );
  }

  if (storesQuery.isError) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-2xl bg-red-50 p-6 text-sm text-red-900">
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
