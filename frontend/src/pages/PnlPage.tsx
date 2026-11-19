import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPnl, savePnlGoal } from "../api/pnl";
import { fetchWeatherMonth } from "../api/weather";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { Dialog } from "../components/Dialog";
import { PnlKpis, PnlKpisSkeleton } from "../components/PnlKpis";
import { PnlDayDialog } from "../components/PnlDayDialog";
import { PnlStatementDialog } from "../components/PnlStatementDialog";
import { Skeleton } from "../components/Skeleton";
import { formatKoreanMonth, shiftMonth, thisMonth, todayIso, won } from "../lib/pnl";
import type { PnlResponse, Store, WeatherMonthDay, WeatherSkyType } from "../types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const SKY_LABEL: Record<WeatherSkyType, string> = {
  RAIN: "비",
  SNOW: "눈",
  DRY: "강수 없음",
  CLEAR: "맑음",
  CLOUDY: "구름많음",
  OVERCAST: "흐림",
};

function weatherTitle(day: WeatherMonthDay): string {
  const sky = day.sky ? SKY_LABEL[day.sky] : "";
  return day.precipitation_mm !== null && Number(day.precipitation_mm) > 0
    ? `${sky} ${day.precipitation_mm}mm`
    : sky;
}

function weatherDetail(day: WeatherMonthDay): string {
  return [
    day.max_temp !== null ? `최고 ${day.max_temp}°` : null,
    day.min_temp !== null ? `최저 ${day.min_temp}°` : null,
    day.precipitation_chance !== null ? `강수확률 ${day.precipitation_chance}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const SUN = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </>
);
const CLOUD = <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />;
const SNOW_ARM = (
  <>
    <path d="M12 2.5v19" />
    <path d="M9.5 5.5 12 8l2.5-2.5M9.5 18.5 12 16l2.5 2.5" />
  </>
);

const SKY_ICON: Record<WeatherSkyType, ReactNode> = {
  RAIN: (
    <>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M8 15v4M12 17v4M16 15v4" />
    </>
  ),
  SNOW: (
    <>
      {SNOW_ARM}
      <g transform="rotate(60 12 12)">{SNOW_ARM}</g>
      <g transform="rotate(120 12 12)">{SNOW_ARM}</g>
    </>
  ),
  DRY: SUN,
  CLEAR: SUN,
  CLOUDY: (
    <>
      <path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.95 12.65a4 4 0 0 0-5.93-4.93" />
      <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
    </>
  ),
  OVERCAST: CLOUD,
};

function WeatherIcon({ day, onAccent = false }: { day: WeatherMonthDay; onAccent?: boolean }) {
  if (!day.sky) return null;
  const title = weatherTitle(day);
  const detail = weatherDetail(day);
  const label = `${day.forecast ? "예보 " : ""}${title}${detail ? ` · ${detail}` : ""}`;
  const colorClass = onAccent
    ? "text-white"
    : day.sky === "RAIN" || day.sky === "SNOW"
      ? "text-accent-600"
      : "text-muted";
  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <strong className="font-semibold">
            {day.forecast ? `예보 · ${title}` : title}
          </strong>
          {detail && <span className="tabular-nums">{detail}</span>}
        </span>
      }
      touchTrigger="tap"
      focusTrigger="always"
      hasHoverIndication={false}
    >
      <button
        type="button"
        aria-label={label}
        className={`pnl-weather-icon ${colorClass} ${day.forecast ? "opacity-40" : ""}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {SKY_ICON[day.sky]}
        </svg>
      </button>
    </Tooltip>
  );
}

function PnlCalendar({
  store,
  days,
  weatherByDate,
}: {
  store: Store;
  days: PnlResponse["daily"];
  weatherByDate: Map<string, WeatherMonthDay>;
}) {
  const today = todayIso();
  const inMonth = days.some((d) => d.date === today);
  const [picked, setPicked] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  if (days.length === 0) return null;
  const selected = days.find((d) => d.date === picked) ?? days.find((d) => d.date === today) ?? days[0];
  const [y, m] = days[0].date.split("-").map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const selWeather = weatherByDate.get(selected.date);
  const selNet = selected.revenue - selected.expenses;
  const [, sm, sd] = selected.date.split("-").map(Number);
  const openDays = store.business_days?.split(",");
  // 달력 기준(날짜 있는 기록)이라 월 고정비가 빠진 값이다.
  const monthRevenue = days.reduce((s, d) => s + d.revenue, 0);
  const monthExpenses = days.reduce((s, d) => s + d.expenses, 0);
  return (
    <section className="card">
      <div className="card-head">
        <h2>일별 매출 · 지출</h2>
        <span className="flex items-center gap-3">
          <span className="hidden items-center gap-3 text-xs text-muted sm:flex">
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-accent-600" />매출</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#b42318]" />지출</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rule" />5일 예보</span>
          </span>
          <span className="card-meta">{y}.{String(m).padStart(2, "0")}</span>
          <Tooltip
            content="오늘과 지난 날은 관측값, 흐린 아이콘은 오늘 기준 5일 예보예요. 출처: 기상청"
            touchTrigger="tap"
            focusTrigger="always"
            hasHoverIndication={false}
          >
            <button type="button" className="inventory-info-button" aria-label="날씨 표시 안내">
              ⓘ
            </button>
          </Tooltip>
        </span>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,680px)_minmax(280px,1fr)]">
        <div className="grid grid-cols-7 gap-1.5 text-xs">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`pb-1 text-center font-semibold ${i === 0 ? "text-[#b42318]" : i === 6 ? "text-accent-700" : "text-muted"}`}
            >
              {w}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`lead-${i}`} />
          ))}
          {days.map((d) => {
            const weather = weatherByDate.get(d.date);
            const isToday = d.date === today;
            const isSel = d.date === selected.date;
            const isFuture = d.date > today;
            const dow = (lead + Number(d.date.slice(8)) - 1) % 7;
            const hasMoney = d.revenue > 0 || d.expenses > 0;
            const closed = !hasMoney && !!openDays && !openDays.includes(WEEKDAYS[dow]);
            const dayColor = isToday
              ? "text-white"
              : isFuture
                ? "text-muted"
                : dow === 0
                  ? "text-[#b42318]"
                  : dow === 6
                    ? "text-accent-700"
                    : "text-ink";
            return (
              // 날씨 아이콘이 자체 버튼(툴팁)이라 칸은 div+role=button (button 중첩 금지)
              <div
                role="button"
                tabIndex={0}
                key={d.date}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSel}
                onClick={() => setPicked(d.date)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPicked(d.date);
                  }
                }}
                className={`flex min-h-[92px] cursor-pointer min-w-0 flex-col gap-1.5 rounded-xl border-2 p-1.5 text-left transition-colors ${
                  isToday
                    ? "border-accent-600 bg-accent-600 text-white ring-2 ring-accent-300 ring-offset-1"
                    : isSel
                      ? "border-accent-600 bg-accent-50"
                      : isFuture
                        ? "border-transparent bg-ground/60 hover:bg-accent-50"
                        : "border-transparent bg-ground hover:bg-accent-50"
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1 tabular-nums">
                  <span className="flex items-center gap-1">
                    <span className={`text-sm font-bold ${dayColor}`}>{Number(d.date.slice(8))}</span>
                    {isToday && (
                      <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-semibold leading-4">오늘</span>
                    )}
                  </span>
                  {weather && <WeatherIcon day={weather} onAccent={isToday} />}
                </div>
                {hasMoney && (
                  <div className="mt-auto w-full rounded-lg bg-white px-0.5 py-1 text-center text-xs font-semibold tabular-nums leading-5">
                    {d.revenue > 0 && <div className="truncate text-accent-700">+{d.revenue.toLocaleString("ko-KR")}</div>}
                    {d.expenses > 0 && <div className="truncate text-[#b42318]">-{d.expenses.toLocaleString("ko-KR")}</div>}
                  </div>
                )}
                {closed && (
                  <div className="mt-auto w-full rounded-lg bg-white py-1 text-center text-[13px] text-muted">휴무</div>
                )}
              </div>
            );
          })}
        </div>

        <aside className="flex flex-col gap-3 rounded-2xl bg-ground p-5" aria-live="polite">
          <div className="flex items-center justify-between">
            <strong className="text-xl font-bold">
              {sm}월 {sd}일 ({WEEKDAYS[(lead + sd - 1) % 7]})
            </strong>
            {selected.date === today ? (
              <span className="rounded-full bg-accent-600 px-2.5 py-0.5 text-xs font-semibold text-white">오늘</span>
            ) : (
              inMonth && (
                <button type="button" className="pill pill-soft" onClick={() => setPicked(today)}>
                  오늘로
                </button>
              )
            )}
          </div>
          {selWeather && (
            <div className="flex items-center gap-3 rounded-xl bg-white p-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-50 [&_svg]:h-7 [&_svg]:w-7">
                <WeatherIcon day={selWeather} />
              </span>
              <div>
                <div className="text-base font-bold">{weatherTitle(selWeather)}</div>
                <div className="text-sm text-muted">{weatherDetail(selWeather)}</div>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2.5 rounded-xl bg-white p-4 tabular-nums">
            <div className="flex justify-between">
              <span className="text-muted">일 매출</span>
              <span className="text-lg font-bold text-accent-700">+{won(selected.revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">일 지출</span>
              <span className="text-lg font-bold text-[#b42318]">-{won(selected.expenses)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-rule pt-3 font-bold">
              <span>일손익</span>
              <span className={`text-xl ${selNet < 0 ? "text-[#b42318]" : "text-ink"}`}>
                {selNet >= 0 ? "+" : ""}
                {won(selNet)}
              </span>
            </div>
          </div>
          <button type="button" className="pill pill-primary w-full justify-center" onClick={() => setDetailOpen(true)}>
            상세보기
          </button>
          <div className="grid grid-cols-2 gap-3 tabular-nums">
            <div className="rounded-xl bg-white p-3">
              <div className="text-xs text-muted">{m}월 누적 매출</div>
              <div className="text-lg font-bold text-accent-700">{won(monthRevenue)}</div>
            </div>
            <div className="rounded-xl bg-white p-3">
              <div className="text-xs text-muted">{m}월 누적 지출</div>
              <div className="text-lg font-bold text-[#b42318]">{won(monthExpenses)}</div>
            </div>
          </div>
        </aside>
      </div>
      {detailOpen && <PnlDayDialog store={store} day={selected.date} onClose={() => setDetailOpen(false)} />}
    </section>
  );
}

function GoalDialog({
  store,
  pnl,
  onClose,
}: {
  store: Store;
  pnl: PnlResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [revenue, setRevenue] = useState(pnl.goal.revenue_target?.toString() ?? "");
  const [profit, setProfit] = useState(pnl.goal.profit_target?.toString() ?? "");
  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
  const save = useMutation({
    mutationFn: () => savePnlGoal(store.id, pnl.month, { revenue_target: toNum(revenue), profit_target: toNum(profit) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["pnl", store.id, pnl.month], data);
      queryClient.invalidateQueries({ queryKey: ["pnl", store.id] });
      onClose();
    },
  });
  const field = "h-10 w-full rounded-lg bg-ground px-3 text-right text-sm text-ink tabular-nums";
  return (
    <Dialog label="월 목표" onClose={onClose}>
      <section className="card flex w-full max-w-sm flex-col gap-4" aria-label="월 목표 입력">
        <div className="card-head !mb-0">
          <h2>{formatKoreanMonth(pnl.month)} 목표</h2>
        </div>
        {pnl.goal.inherited_from && <p className="text-sm text-muted">{formatKoreanMonth(pnl.goal.inherited_from)} 목표를 이어받았어요. 저장하면 이번 달 목표로 정해져요.</p>}
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          목표 매출(원)
          <input type="number" min={0} max={10000000000} step={1} inputMode="numeric" className={field} value={revenue} onChange={(e) => setRevenue(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          목표 영업이익(원)
          <input type="number" min={-10000000000} max={10000000000} step={1} inputMode="numeric" className={field} value={profit} onChange={(e) => setProfit(e.target.value)} />
        </label>
        {save.isError && <div className="text-sm text-[#b42318]">저장 실패: {(save.error as Error).message}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="pill pill-sm pill-soft" onClick={onClose}>
            취소
          </button>
          <button type="button" className="pill pill-sm pill-primary" disabled={save.isPending || [toNum(revenue), toNum(profit)].some((v) => v !== null && (!Number.isSafeInteger(v) || Math.abs(v) > 10000000000)) || (toNum(revenue) ?? 0) < 0} onClick={() => save.mutate()}>
            {save.isPending ? "저장 중…" : "저장"}
          </button>
        </div>
      </section>
    </Dialog>
  );
}

function PnlCalendarSkeleton() {
  return (
    <section className="card" role="status" aria-busy="true" aria-label="일별 매출·지출 불러오는 중">
      <div className="card-head">
        <h2>일별 매출 · 지출</h2>
        <span className="flex items-center gap-3">
          <Skeleton width={64} height={14} variant="text" />
        </span>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,680px)_minmax(280px,1fr)]">
        <div className="grid grid-cols-7 gap-1.5 text-xs">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`pb-1 text-center font-semibold ${i === 0 ? "text-[#b42318]" : i === 6 ? "text-accent-700" : "text-muted"}`}
            >
              {w}
            </div>
          ))}
          {Array.from({ length: 35 }, (_, idx) => (
            <div
              key={idx}
              className="flex min-h-[92px] min-w-0 flex-col gap-1.5 rounded-xl bg-ground p-1.5"
            >
              <Skeleton width={20} height={14} variant="text" />
              <div className="mt-auto flex flex-col gap-1 rounded-lg bg-white p-1.5">
                <Skeleton width="76%" height={10} variant="text" />
                <Skeleton width="58%" height={10} variant="text" />
              </div>
            </div>
          ))}
        </div>

        <aside className="flex flex-col gap-3 rounded-2xl bg-ground p-5">
          <div className="flex items-center justify-between">
            <Skeleton width={132} height={24} />
            <Skeleton width={48} height={22} variant="pill" />
          </div>
          <div className="flex flex-col gap-2.5 rounded-xl bg-white p-4">
            <Skeleton width="42%" height={12} variant="text" />
            <Skeleton width="68%" height={22} />
            <Skeleton width="56%" height={12} variant="text" />
          </div>
          <div className="flex flex-col gap-2.5 rounded-xl bg-white p-4">
            <Skeleton width="48%" height={12} variant="text" />
            <Skeleton width="62%" height={18} />
            <Skeleton width="54%" height={18} />
          </div>
        </aside>
      </div>
    </section>
  );
}

export function PnlPage({ store }: { store: Store }) {
  const [month, setMonth] = useState(thisMonth);
  const [statementOpen, setStatementOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const current = thisMonth();

  const pnlQuery = useQuery({
    queryKey: ["pnl", store.id, month],
    queryFn: () => fetchPnl(store.id, month),
  });

  const weatherQuery = useQuery({
    queryKey: ["weather", month],
    queryFn: () => fetchWeatherMonth(month),
  });

  const weatherByDate = new Map<string, WeatherMonthDay>(
    weatherQuery.data?.station_id != null ? weatherQuery.data.days.map((d) => [d.date, d]) : []
  );

  const pnl = pnlQuery.data;
  const cmp = pnl?.comparison;

  return (
    <div className="pnl-page">
      <div className="page-heading">
        <div className="page-title">
          <h1>손익</h1>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="pill pill-sm pill-secondary"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="이전 달"
          >
            ‹
          </button>
          <span aria-label="손익 월" className="pill pill-sm pill-secondary cursor-default select-none tabular-nums">
            {formatKoreanMonth(month)}
          </span>
          <button
            type="button"
            className="pill pill-sm pill-secondary"
            disabled={month >= current}
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="다음 달"
          >
            ›
          </button>
          {pnlQuery.isLoading ? (
            <>
              <Skeleton width={76} height={32} variant="pill" />
              <Skeleton width={88} height={32} variant="pill" />
            </>
          ) : (
            pnl && (
              <>
                <button type="button" className="pill pill-sm pill-soft" onClick={() => setGoalOpen(true)}>
                  목표 설정
                </button>
                <button type="button" className="pill pill-sm pill-primary" onClick={() => setStatementOpen(true)}>
                  손익계산 &gt;
                </button>
              </>
            )
          )}
        </div>
      </div>

      {pnlQuery.isError && (
        <div className="mb-4 rounded-2xl bg-[#fdecec] px-4 py-3 text-sm text-[#b42318]">
          손익을 불러오지 못했습니다: {(pnlQuery.error as Error).message}
        </div>
      )}

      {pnlQuery.isLoading && (
        <div className="flex flex-col gap-4 xl:gap-5">
          <PnlKpisSkeleton />
          <PnlCalendarSkeleton />
        </div>
      )}

      {pnl && cmp && (
        <div className="flex flex-col gap-4 xl:gap-5">
          <PnlKpis pnl={pnl} store={store} onEditGoal={() => setGoalOpen(true)} onPickMonth={setMonth} />

          <PnlCalendar store={store} days={pnl.daily} weatherByDate={weatherByDate} />
        </div>
      )}

      {pnl && statementOpen && <PnlStatementDialog store={store} pnl={pnl} onClose={() => setStatementOpen(false)} />}
      {pnl && goalOpen && <GoalDialog store={store} pnl={pnl} onClose={() => setGoalOpen(false)} />}
    </div>
  );
}
