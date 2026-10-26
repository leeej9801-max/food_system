import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
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
    <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-900">
          매장 초기 설정 ({step} / 2)
        </span>
        <span className="text-xs font-medium text-slate-500">태블릿 터치 최적화</span>
      </div>
      <h1 className="mt-3 text-2xl font-bold text-slate-900">새 매장 시작하기</h1>
      <p className="mt-1 text-sm text-slate-600">
        요일과 운영시간, 테이블 수를 터치로 간편하게 선택하세요. 생성 후 설정 화면에서도 언제든
        변경할 수 있습니다.
      </p>

      {error && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      {step === 1 ? (
        <form onSubmit={handleNextStep} className="mt-5 space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              매장명 <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 비스트로 서울"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-medium focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800">
                영업 요일 선택 (터치 토글)
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedDays(["화", "수", "목", "금", "토", "일"])}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  월요일 휴무
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDays([...ALL_DAYS])}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  매일 영업
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDays(["월", "화", "수", "목", "금"])}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
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
                    className={`flex h-12 items-center justify-center rounded-xl border text-base font-bold transition ${
                      active
                        ? "border-blue-600 bg-blue-600 text-white shadow-xs"
                        : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              선택됨:{" "}
              <span className="font-bold text-slate-900">
                {businessDaysStr || "선택 안 됨"}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-xs font-bold text-slate-800">
              운영 시간 (터치 선택)
            </label>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600">오픈 시간</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {OPEN_TIME_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setOpenTime(t)}
                      className={`rounded-lg border py-2 text-xs font-bold ${
                        openTime === t
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600">마감 시간</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {CLOSE_TIME_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCloseTime(t)}
                      className={`rounded-lg border py-2 text-xs font-bold ${
                        closeTime === t
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2.5 text-xs text-slate-600">
              설정된 운영시간:{" "}
              <span className="font-bold text-slate-900">{openingHoursStr}</span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white hover:bg-blue-700"
          >
            다음 단계 (테이블 구성) →
          </button>
        </form>
      ) : (
        <form onSubmit={handleCreateStore} className="mt-5 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <label className="block text-sm font-bold text-slate-800">
              매장 홀 테이블 수 (터치 조절)
            </label>
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                onClick={() => setTableCount((c) => Math.max(1, c - 1))}
                className="flex h-12 w-14 items-center justify-center rounded-xl border border-slate-300 bg-white text-xl font-bold text-slate-800 active:bg-slate-100"
              >
                -
              </button>
              <span className="min-w-[110px] text-center text-2xl font-extrabold text-slate-900">
                {tableCount}개 테이블
              </span>
              <button
                type="button"
                onClick={() => setTableCount((c) => Math.min(30, c + 1))}
                className="flex h-12 w-14 items-center justify-center rounded-xl border border-slate-300 bg-white text-xl font-bold text-slate-800 active:bg-slate-100"
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
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {cnt}개
                </button>
              ))}
            </div>

            <label className="mt-5 block text-sm font-bold text-slate-800">
              테이블당 기본 좌석 수 (생성 후 개별 변경 가능)
            </label>
            <div className="mt-2.5 grid grid-cols-3 gap-2.5">
              {[2, 4, 6].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDefaultSeats(s)}
                  className={`rounded-xl border py-3 text-sm font-bold ${
                    defaultSeats === s
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-300 bg-white text-slate-700"
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
              className="w-1/3 rounded-xl border border-slate-300 py-3.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
            >
              ← 이전
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-2/3 rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-50"
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
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* 태블릿 친화형 컴팩트 상단 상태 & 네비게이션 바 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur-xs">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
          {/* 좌측: 사이드 메뉴 토글 + 매장 정보 + 도트 홀 iOS 슬라이딩 스위치 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="사이드 메뉴 토글"
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                sidebarOpen
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100"
              }`}
            >
              <span>{sidebarOpen ? "메뉴 닫기" : "메뉴 · 탭 이동"}</span>
            </button>

            <Link
              to="/home"
              className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-slate-100"
            >
              <span className="text-base font-extrabold text-slate-900">{store.name}</span>
              <span className="hidden rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline-block">
                {store.business_days ?? "영업일 미설정"} · {store.opening_hours ?? "시간 미설정"}
              </span>
            </Link>

            {/* iOS 스타일 도트 홀 ON / OFF 슬라이딩 토글 스위치 */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1">
              <span className="text-xs font-bold text-slate-700">2D 도트 홀</span>
              <button
                type="button"
                role="switch"
                aria-checked={metaverseMode}
                aria-label="2D 도트 홀 모드 전환"
                onClick={() => handleSetMetaverseMode(!metaverseMode)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  metaverseMode ? "bg-emerald-500" : "bg-slate-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    metaverseMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <span
                className={`w-6 text-[11px] font-extrabold ${
                  metaverseMode ? "text-emerald-700" : "text-slate-500"
                }`}
              >
                {metaverseMode ? "ON" : "OFF"}
              </span>
            </div>

            {currentNav && location.pathname !== "/home" && (
              <Link
                to="/home"
                className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
              >
                ← 홀 테이블(HOME)로 복귀
              </Link>
            )}
          </div>

          {/* 우측: 축소된 핵심 KPI 요약 배지 */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-1.5 font-semibold text-blue-950">
              <span className="text-blue-600">● 홀 착석</span>
              <span className="font-extrabold">
                {visitSummary?.active_table_count ?? 0}/{activeTablesCount}테이블
              </span>
              <span className="text-blue-700">({visitSummary?.active_guest_count ?? 0}명)</span>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800">
              <span className="text-slate-500">누적 방문</span>
              <span className="font-extrabold">
                {visitSummary?.total_visit_count ?? 0}팀 · {visitSummary?.total_guest_count ?? 0}명
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 font-semibold text-emerald-950">
              <span className="text-emerald-700">순매출</span>
              <span className="font-extrabold">
                {integration && integration.total_orders_count > 0
                  ? `${Number(integration.net_sales_amount).toLocaleString("ko-KR")}원 (${integration.total_orders_count}건)`
                  : "0원"}
              </span>
            </div>

            <Link
              to="/settings"
              className={`hidden items-center gap-1 rounded-xl px-2.5 py-1.5 font-bold xl:inline-flex ${
                integration?.connection_status === "READY_CSV"
                  ? "bg-slate-200/80 text-slate-800 hover:bg-slate-300/70"
                  : "bg-amber-100 text-amber-900"
              }`}
            >
              <span>
                {integration?.mode === "CSV_UPLOAD"
                  ? "CSV/수동모드"
                  : `${integration?.mode ?? "POS"} (미검증)`}
              </span>
            </Link>
          </div>
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
            <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
              <div className="mb-2 flex items-center justify-between px-2">
                <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  화면 이동 (브레이크·마감)
                </span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  접기
                </button>
              </div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const active = location.pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => {
                        if (window.innerWidth < 1024 || item.to === "/home") {
                          setSidebarOpen(false);
                        }
                      }}
                      className={`flex items-center rounded-xl px-3 py-3 text-sm font-bold transition ${
                        active
                          ? "bg-blue-600 text-white shadow-xs"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </aside>
          )}

          <main className="min-w-0">
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route
                path="/home"
                element={<HomePage store={store} metaverseMode={metaverseMode} />}
              />
              <Route path="/menus" element={<MenuManagementPage store={store} />} />
              <Route path="/ingredients" element={<IngredientManagementPage store={store} />} />
              <Route path="/inventory" element={<InventoryPage store={store} />} />
              <Route path="/analytics" element={<AnalyticsPage store={store} />} />
              <Route path="/settings" element={<SettingsPage store={store} />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const storesQuery = useQuery({
    queryKey: ["stores"],
    queryFn: fetchStores,
  });

  if (storesQuery.isLoading) {
    return (
      <div className="p-10 text-center text-sm text-slate-600">
        매장 정보를 확인하는 중입니다...
      </div>
    );
  }

  if (storesQuery.isError) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-900">
        <h1 className="text-base font-bold">백엔드 API 서버에 연결할 수 없습니다</h1>
        <p className="mt-2">
          FastAPI 서버가 실행 중인지 확인해 주세요. (기본 주소:{" "}
          <code>http://localhost:8000/api/v1</code>)
        </p>
      </div>
    );
  }

  const firstStore = (storesQuery.data ?? [])[0];
  if (!firstStore) {
    return (
      <StoreBootstrapWizard
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["stores"] });
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <ShellLayout store={firstStore} />
    </BrowserRouter>
  );
}
