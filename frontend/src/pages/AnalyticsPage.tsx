import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGuestAnalytics, fetchSalesAnalytics } from "../api/analytics";
import { fetchPnl, fetchPnlDay } from "../api/pnl";
import { fetchTodaySummary } from "../api/todaySummary";
import { Skeleton } from "../components/Skeleton";
import { periodFor, storeDay } from "../lib/attendance";
import { useAnimatedNumber } from "../lib/useAnimatedNumber";
import type { Store, WeatherGroupItem } from "../types";

interface AnalyticsPageProps { store: Store }
type Period = "today" | "week" | "month" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "오늘" }, { key: "week", label: "이번주" },
  { key: "month", label: "이번달" }, { key: "all", label: "전체" },
];
const AGES = ["10S", "20S", "30S", "40S", "50S", "60S_PLUS"];
const LABELS: Record<string, string> = {
  "10S": "10대", "20S": "20대", "30S": "30대", "40S": "40대", "50S": "50대", "60S_PLUS": "60+",
  MIXED: "혼합", ALONE: "혼자", COUPLE: "연인", FRIENDS: "친구", FAMILY: "가족", COWORKERS: "동료", OTHER: "기타",
};
const WEATHER: { key: WeatherGroupItem["key"]; label: string }[] = [
  { key: "DRY", label: "맑은 날" }, { key: "RAIN", label: "비 온 날" },
  { key: "HOT", label: "25도 이상" }, { key: "MILD", label: "15~25도" },
  { key: "COOL", label: "5~15도" }, { key: "COLD", label: "5도 미만" },
];
const COLORS = ["var(--kpi-c1)", "var(--kpi-c2)", "var(--kpi-c3)", "var(--kpi-c4)", "var(--kpi-c5)"];
const number = (value: number) => Math.round(value).toLocaleString("ko-KR");
const numeric = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const count = (value: number | null | undefined, unit: string) => value == null ? "미산출" : `${number(value)}${unit}`;
const percentage = (value: number, total: number) => total > 0 ? value / total * 100 : null;
const shortDate = (value: string) => value.replaceAll("-", ".");

function Info({ text }: { text: string }) {
  return <button type="button" className="kpi-info" aria-label={text} title={text}>i</button>;
}

function Money({ value, loading = false, gradient = false }: { value: number | null; loading?: boolean; gradient?: boolean }) {
  const compact = value !== null && Math.abs(value) >= 10_000_000;
  const shown = useAnimatedNumber(value === null ? null : compact ? value / 10000 : value);
  return <div className="kpi-big">{loading ? <Skeleton width="75%" height={36} /> : value === null ?
    <span className="kpi-na">미산출</span> : <><span className={gradient ? "kpi-grad" : undefined}>{number(shown ?? value)}</span><em>{compact ? "만원" : "원"}</em></>}</div>;
}

function Silhouette({ female, percent }: { female?: boolean; percent: number | null }) {
  const id = useId();
  const animated = useAnimatedNumber(percent);
  const fill = Math.max(0, Math.min(100, animated ?? 0));
  const path = female
    ? "M22 4a9 9 0 1 1 0 18a9 9 0 1 1 0-18Z M14 26h16a4 4 0 0 1 4 3l6 35H30v26h-6V64h-4v26h-6V64H4l6-35a4 4 0 0 1 4-3Z"
    : "M22 4a9 9 0 1 1 0 18a9 9 0 1 1 0-18Z M12 26h20a4 4 0 0 1 4 4l2 26h-6l-2-20v54h-7V60h-2v30h-7V36l-2 20H6l2-26a4 4 0 0 1 4-4Z";
  return <div className="sil-item">
    <svg className={`sil-svg ${female ? "is-female" : ""}`} viewBox="0 0 44 96" aria-hidden="true">
      <defs><clipPath id={id}><path d={path} /></clipPath></defs>
      <path d={path} className="sil-base" />
      <rect clipPath={`url(#${id})`} x="0" y={90 - 86 * fill / 100} width="44" height="96" fill="currentColor" />
    </svg>
    <span className="sil-label">{female ? "여성" : "남성"}</span>
    <span className="sil-val">{percent === null ? "미산출" : `${percent.toFixed(1)}%`}</span>
  </div>;
}

function WeatherIcon({ kind }: { kind: string }) {
  return <span className={`w-icon weather-${kind.toLowerCase()}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {kind === "DRY" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M5 5l1.4 1.4M17.6 17.6 19 19M2 12h2M20 12h2M6.4 17.6 5 19M19 5l-1.4 1.4" /></> :
        kind === "RAIN" ? <><path d="M4 15A7 7 0 1 1 16 8h1a4.5 4.5 0 0 1 3 8" /><path d="M8 15v4M12 17v4M16 15v4" /></> :
          <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />}
    </svg>
  </span>;
}

// 시안 A 대시보드 배치 (U-52): 제목 줄 → 지표 3칸 → 시간대 차트·메뉴 순위 (원가 시뮬레이션은 실험실로 이동)
// 승인된 analytics/mockup_analytics_A.html에 따라 KPI 4칸과 객층·관계·날씨 영역을 적용한다.
export function AnalyticsPage({ store }: AnalyticsPageProps) {
  const [period, setPeriod] = useState<Period>("all");
  const [rankBy, setRankBy] = useState<"quantity" | "margin">("quantity");
  const [showAll, setShowAll] = useState(false);
  const today = storeDay(new Date(), store.timezone);
  const month = today.slice(0, 7);
  const salesQuery = useQuery({ queryKey: ["analytics-sales", store.id], queryFn: () => fetchSalesAnalytics(store.id) });
  const guestQuery = useQuery({ queryKey: ["analytics-guests", store.id], queryFn: () => fetchGuestAnalytics(store.id) });
  const pnlQuery = useQuery({ queryKey: ["pnl", store.id, month], queryFn: () => fetchPnl(store.id, month) });
  const todayQuery = useQuery({ queryKey: ["today-summary", store.id, today], queryFn: () => fetchTodaySummary(store.id), enabled: period === "today" });
  const dayQuery = useQuery({ queryKey: ["pnl-day", store.id, today], queryFn: () => fetchPnlDay(store.id, today), enabled: period === "today" });
  const sales = salesQuery.isError ? undefined : salesQuery.data;
  const guests = guestQuery.isError ? undefined : guestQuery.data;
  const pnl = pnlQuery.isError ? undefined : pnlQuery.data;
  const day = dayQuery.isError ? undefined : dayQuery.data;
  const summary = todayQuery.isError ? undefined : todayQuery.data;
  const current = period === "week" ? pnl?.comparison.weekly.current : pnl?.comparison.monthly_average.current;
  const revenue = period === "all" ? numeric(sales?.total_net_sales) : period === "today" ? numeric(summary?.today_net_sales_amount) : current?.revenue ?? null;
  const profit = period === "all" ? null : period === "today" ? day?.operating_profit ?? null : current?.operating_profit ?? null;
  const expenses = period === "all" ? null : period === "today" ? day?.expenses ?? null : current?.expenses ?? null;
  const guestCount = period === "all" ? guests?.guest_count : period === "today" ? summary?.today_guest_count : null;
  const visitCount = period === "all" ? guests?.visit_count : period === "today" ? summary?.today_visit_count : null;
  const ticket = revenue !== null && guestCount != null && guestCount > 0 ? revenue / guestCount : null;
  const revenueLoading = period === "all" ? salesQuery.isLoading : period === "today" ? todayQuery.isLoading : pnlQuery.isLoading;
  const profitLoading = period === "today" ? dayQuery.isLoading : period !== "all" && pnlQuery.isLoading;
  const target = numeric(pnl?.goal.revenue_target);
  const goalPercent = period === "month" && target !== null && target > 0 && revenue !== null ? revenue / target * 100 : null;
  const animatedGoal = useAnimatedNumber(goalPercent);
  const weekStart = periodFor(today, "week").start;
  const rangeStart = period === "today" ? today : period === "week" ? weekStart : `${month}-01`;
  const dateLabel = period === "all" ? `전체 기록 · ${shortDate(today)}까지` : rangeStart === today ? shortDate(today) : `${shortDate(rangeStart)} ~ ${shortDate(today).slice(5)}`;
  const comparison = period === "today" ? pnl?.kpi.yesterday.revenue : period === "week" ? pnl?.comparison.weekly.baseline?.revenue :
    period === "month" && pnl?.kpi.previous_to_date_has_data ? pnl.comparison.previous_to_date?.revenue : null;
  const delta = revenue !== null && comparison != null && comparison > 0 ? (revenue - comparison) / comparison * 100 : null;
  const hours = (sales?.hourly_buckets ?? []).filter((bucket) => bucket.quantity > 0 || (bucket.hour >= 11 && bucket.hour <= 21));
  const maxHour = Math.max(1, ...hours.map((bucket) => bucket.quantity));
  const peak = hours.reduce<(typeof hours)[number] | null>((best, bucket) => bucket.quantity > 0 && (!best || bucket.quantity > best.quantity) ? bucket : best, null);
  const ageTotal = guests?.age_bands.reduce((sum, bucket) => sum + bucket.count, 0) ?? 0;
  const genderTotal = guests?.genders.reduce((sum, bucket) => sum + bucket.count, 0) ?? 0;
  const genderShare = (key: string) => {
    const bucket = guests?.genders.find((item) => item.key === key);
    return genderTotal > 0 ? percentage(bucket?.count ?? 0, genderTotal) : null;
  };
  const ageKeys = [...AGES, ...(guests?.age_bands.filter((item) => !AGES.includes(item.key)).map((item) => item.key) ?? [])];
  const relationships = guests?.relationships ?? [];
  const relationshipTotal = relationships.reduce((sum, bucket) => sum + bucket.count, 0);
  const relationshipKeys = relationships.length ? relationships.map((item) => item.key) : ["COUPLE", "FRIENDS", "FAMILY"];
  const rankings = [...(sales?.menu_rankings ?? [])].sort((a, b) => b.quantity - a.quantity);
  const shownRankings = showAll ? rankings : rankings.slice(0, 4);
  const maxQuantity = Math.max(1, ...rankings.map((item) => item.quantity));
  const failed = salesQuery.isError || guestQuery.isError || pnlQuery.isError || (period === "today" && (todayQuery.isError || dayQuery.isError));

  return <div className="analytics-page kpi-page">
    <div className="top-bar">
      <div className="top-bar-left"><h1 className="page-h1">분석</h1>
        <div className="kpi-tabs" role="group" aria-label="KPI 조회 기간">
          {PERIODS.map((item) => <button type="button" key={item.key} className={period === item.key ? "on" : ""} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
        </div>
      </div>
      <span className="date-range"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>{dateLabel}</span>
    </div>
    {failed && <div className="analytics-error" role="status">일부 데이터를 불러오지 못했습니다. 해당 지표는 미산출로 표시합니다.
      <button type="button" onClick={() => { void salesQuery.refetch(); void guestQuery.refetch(); void pnlQuery.refetch(); if (period === "today") { void todayQuery.refetch(); void dayQuery.refetch(); } }}>다시 불러오기</button>
    </div>}
    <div className="kpi-four-grid">
      <section className="kpi-card analytics-kpi">
        <div className="kpi-head"><span className="kpi-head-title"><b>매출</b><Info text="완료 주문의 순매출입니다. 월·주 매출은 손익 집계 기준입니다." /></span>
          <span className={`analytics-chip ${delta === null ? "" : delta >= 0 ? "is-up" : "is-down"}`}>{delta !== null ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%` : period === "all" ? `주문 ${count(sales?.total_completed_orders, "건")}` : "기간 매출"}</span></div>
        <Money value={revenue} loading={revenueLoading} gradient />
        <div className="kpi-card-foot"><span>{period === "all" ? "판매 수량" : period === "today" ? "어제 매출" : period === "week" ? "지난주 동기" : "전월 동기"}</span><b>{period === "all" ? count(sales?.total_quantity, "개") : count(comparison, "원")}</b></div>
      </section>
      <section className="kpi-card analytics-kpi">
        <div className="kpi-head"><span className="kpi-head-title"><b>영업이익</b><Info text="매출에서 집계된 지출을 뺀 값입니다. 오늘은 입고·카드수수료만 반영하며 월 고정비는 제외합니다. 전체 기간 손익은 미산출입니다." /></span>
          <span className="analytics-chip">{period === "all" ? "전체 손익 미제공" : period === "today" ? "월 고정비 제외" : period === "week" ? "고정비 일할 반영" : "월 고정비 포함"}</span></div>
        <Money value={profit} loading={profitLoading} />
        <div className="kpi-card-foot"><span>총지출</span><b>{count(expenses, "원")}</b></div>
      </section>
      <section className="kpi-card analytics-kpi">
        <div className="kpi-head"><span className="kpi-head-title"><b>객단가</b><Info text="선택 기간 매출 ÷ 방문 손님 수입니다. 주·월 손님 집계는 제공되지 않습니다." /></span><span className="analytics-chip">{guestCount == null ? "손님 수 미제공" : `손님 ${count(guestCount, "명")}`}</span></div>
        <Money value={ticket} loading={revenueLoading || (period === "all" && guestQuery.isLoading)} />
        <div className="kpi-card-foot"><span>방문 팀수</span><b>{count(visitCount, "팀")}</b></div>
      </section>
      <section className="kpi-card analytics-kpi">
        <div className="kpi-head"><span className="kpi-head-title"><b>목표</b><Info text="이번달 매출 ÷ 월 매출 목표입니다. 일·주·전체 목표는 제공되지 않습니다." /></span><span className="analytics-chip">{Number(month.slice(5))}월 {target === null ? "목표 미설정" : `${number(target / 10000)}만원`}</span></div>
        <div className="goal-gauge-row"><div className="kpi-big">{goalPercent === null ? <span className="kpi-na">미산출</span> : <>{(animatedGoal ?? goalPercent).toFixed(1)}<em>%</em></>}</div>
          <svg viewBox="0 0 120 68" className="goal-gauge-svg" aria-hidden="true"><path d="M12 58 A48 48 0 0 1 108 58" className="goal-track" /><path d="M12 58 A48 48 0 0 1 108 58" className="goal-fill" opacity={goalPercent === null ? 0 : 1} pathLength="100" strokeDasharray="100" strokeDashoffset={100 - Math.max(0, Math.min(100, animatedGoal ?? 0))} /></svg>
        </div>
        <div className="kpi-card-foot"><span>목표 기준</span><b>{period !== "month" ? "월 목표만 제공" : goalPercent === null ? "미산출" : `남은 ${number(Math.max(0, (target ?? 0) - (revenue ?? 0)))}원`}</b></div>
      </section>
    </div>
    <p className="analytics-scope">아래 차트는 전체 기록 기준입니다. 기간 선택은 위 KPI에 적용됩니다.</p>
    <div className="mid-grid">
      <section className="kpi-card">
        <div className="kpi-head"><span className="kpi-head-title"><h2>시간대별 판매</h2><Info text="방문 수가 아닌 판매 수량입니다. 시각이 있는 완료 주문만 포함합니다." /></span><span className="analytics-chip is-accent">{peak ? `피크 ${peak.hour}시 · ${number(peak.quantity)}개` : "미산출"}</span></div>
        <div className="hourly-wrap">
          {salesQuery.isLoading ? <div className="analytics-empty" role="status">불러오는 중</div> : hours.length === 0 || !sales?.known_hour_quantity ? <div className="analytics-empty">미산출 · 시각이 있는 판매 기록이 없습니다</div> :
            <div className="hourly-bars" role="list" aria-label="시간대별 누적 판매 수량">{hours.map((bucket) => <div className={`h-col ${bucket.hour === peak?.hour ? "is-peak" : bucket.quantity >= maxHour * 0.6 ? "is-lunch-peak" : ""}`} role="listitem" key={bucket.hour} aria-label={`${bucket.hour}시 ${number(bucket.quantity)}개`} title={`${number(bucket.quantity)}개 · ${count(numeric(bucket.sales_amount), "원")}`}>
              <span className="h-val">{number(bucket.quantity)}</span><div className="h-track"><div className="h-fill analytics-bar-v" style={{ height: `${bucket.quantity / maxHour * 100}%` }} /></div><span className="h-lbl">{bucket.hour}시</span>
            </div>)}</div>}
          <div className="hourly-axis-foot"><span>{store.opening_hours ?? "영업시간 미설정"}</span><span>평균 체류 {count(guests?.avg_stay_minutes, "분")}</span><span>시각 미상 {count(sales?.unknown_hour_quantity, "개")}</span></div>
        </div>
      </section>
      <section className="kpi-card">
        <div className="kpi-head"><span className="kpi-head-title"><h2>성별·연령 비중</h2><Info text="성별·연령별로 입력된 인원만 분모에 포함합니다. 미기록 인원은 제외합니다." /></span><span className="kpi-meta">입력 {count(guests?.profiled_person_count, "명")}</span></div>
        <div className="demog-layout"><div className="silhouette-pair"><Silhouette percent={genderShare("MALE")} /><Silhouette female percent={genderShare("FEMALE")} /></div>
          <div className="age-rows">{ageKeys.map((key, index) => {
            const value = guests?.age_bands.find((item) => item.key === key)?.count ?? 0;
            const share = percentage(value, ageTotal);
            return <div className="age-row" key={key}><span className="age-name">{LABELS[key] ?? key}</span><span className="age-track"><span className="age-fill analytics-bar-h" style={{ width: `${share ?? 0}%`, background: COLORS[index % 3] }} /></span><span className="age-stat">{share === null ? <span className="kpi-na">미산출</span> : <>{share.toFixed(1)}%<small>{number(value)}명</small></>}</span></div>;
          })}</div>
        </div>
      </section>
    </div>
    <section className="kpi-card">
      <div className="kpi-head"><span className="kpi-head-title"><h2>동반 관계</h2><Info text="관계 입력 팀 기준 비중입니다. TOP3는 주문 시각과 착석 구간이 겹치는 유일한 팀에 매칭한 추정 결과입니다." /></span><span className="kpi-meta">전체 {count(guests?.visit_count, "팀")} · 주문 매칭 {count(guests?.matched_order_count, "건")} · 추정</span></div>
      <div className="rel-body"><div className="rel-summary">
        <div className="kpi-stack" aria-hidden="true">{relationships.filter((item) => item.count > 0).map((item) => <i key={item.key} style={{ flex: item.count, background: COLORS[relationshipKeys.indexOf(item.key) % COLORS.length] }} />)}</div>
        <div className="kpi-rows">{relationshipKeys.map((key, index) => {
          const value = relationships.find((item) => item.key === key)?.count;
          const share = value == null ? null : percentage(value, relationshipTotal);
          return <div className="kpi-row" key={key}><span className="l"><i style={{ background: COLORS[index % COLORS.length] }} />{LABELS[key] ?? key}</span><span className="v">{count(value, "팀")}{share !== null && <small>{share.toFixed(1)}%</small>}</span></div>;
        })}</div>
      </div><div className="rel-menus">{relationshipKeys.map((key, index) => {
        const group = guests?.menu_by_relationship.find((item) => item.key === key);
        const top = [...(group?.top_menus ?? [])].sort((a, b) => b.quantity - a.quantity).slice(0, 3);
        const max = Math.max(1, ...top.map((item) => item.quantity));
        return <div className="rel-group" key={key}><div className="rel-head"><i style={{ background: COLORS[index % COLORS.length] }} /><b>{LABELS[key] ?? key}</b><span>매칭 {count(group?.visit_count, "팀")}</span></div>
          {top.length ? <ol className="rel-top">{top.map((item, rank) => <li key={item.menu_name}><span className="rk">{rank + 1}</span><span className="nm" title={item.menu_name}>{item.menu_name}</span><span className="rel-track"><span className="analytics-bar-h" style={{ width: `${item.quantity / max * 100}%`, background: COLORS[index % COLORS.length] }} /></span><b>{number(item.quantity)}개</b></li>)}</ol> : <p className="rel-empty">미산출 · 연결된 주문 없음</p>}
        </div>;
      })}</div></div>
    </section>
    <div className="bot-grid">
      <section className="kpi-card">
        <div className="kpi-head"><span className="kpi-head-title"><h2>판매 메뉴 순위</h2><Info text="누적 판매량 기준입니다. 메뉴별 원가 정보가 없어 마진액은 미산출입니다." /></span>
          <div className="kpi-head-right"><div className="kpi-tabs-sm" role="group" aria-label="메뉴 순위 기준"><button type="button" className={rankBy === "quantity" ? "on" : ""} aria-pressed={rankBy === "quantity"} onClick={() => setRankBy("quantity")}>판매량</button><button type="button" className={rankBy === "margin" ? "on" : ""} aria-pressed={rankBy === "margin"} onClick={() => setRankBy("margin")}>마진액</button></div>{rankings.length > 4 && <button type="button" className="btn-detail" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "접기" : "전체보기"}</button>}</div>
        </div>
        <div className="rank-layout"><div className="podium-stage" aria-label={rankBy === "quantity" ? "판매량 상위 3개" : "마진액 순위 미산출"}>{[2, 0, 1].map((index) => {
          const item = rankBy === "quantity" ? rankings[index] : undefined;
          return <div className={`pod-col pod-${index + 1}`} key={index}><span className="pod-menu">{item?.menu_name ?? "미산출"}</span><span className="pod-val">{item ? `${number(item.quantity)}개` : "순위 미산출"}</span><div className={`pod-step ${!item ? "is-empty" : ""}`}>{item ? index + 1 : "—"}</div></div>;
        })}</div>
          <ol className="rank-list">{shownRankings.length ? shownRankings.map((item, index) => <li className={`rank-item ${index === 0 && rankBy === "quantity" ? "is-top" : ""}`} key={`${item.menu_item_id}-${item.menu_name}`}><span className="rank-no">{rankBy === "quantity" ? String(index + 1).padStart(2, "0") : "—"}</span><span className="rank-name" title={item.menu_name}>{item.menu_name}{item.mapping_status !== "MAPPED" && <small> · 미연결</small>}</span><span className="rank-num">{rankBy === "quantity" ? `${number(item.quantity)}개` : <span className="kpi-na">미산출</span>}<small>{rankBy === "quantity" ? `${number(Number(item.sales_amount) / 10000)}만` : "원가 정보 미제공"}</small></span><span className="rank-bar-wrap"><span className="rank-bar-fill analytics-bar-h" style={{ width: `${rankBy === "quantity" ? item.quantity / maxQuantity * 100 : 0}%` }} /></span></li>) : <li className="kpi-na">{salesQuery.isLoading ? "불러오는 중" : "미산출 · 판매 기록 없음"}</li>}</ol>
        </div>
        {rankBy === "margin" && <p className="analytics-note">메뉴별 마진액이 제공되지 않아 순위를 계산할 수 없습니다.</p>}
      </section>
      <section className="kpi-card">
        <div className="kpi-head"><span className="kpi-head-title"><h2>날씨 영향 메뉴</h2><Info text="관측된 영업일의 판매량입니다. 강수량 1mm 이상을 비 온 날로 분류합니다. 맑은 날은 강수량 1mm 미만을 뜻합니다." /></span><span className="kpi-meta">{guests?.weather_station_configured ? `관측 ${count(guests.weather_days.length, "일")}` : "관측 미산출"}</span></div>
        <div className="weather-rows">{WEATHER.map(({ key, label }) => {
          const group = guests?.weather_station_configured ? guests.weather_groups.find((item) => item.key === key) : undefined;
          return <div className="w-row" key={key}><span className="w-cond"><WeatherIcon kind={key} />{label}</span><span className="w-days">{count(group?.day_count, "일")}</span><div className="w-menus">{group?.top_menus.length ? group.top_menus.slice(0, 2).map((item, index) => <span className="w-menu-pill" key={item.menu_name} title={`${item.menu_name} ${number(item.quantity)}개`}><span>{index + 1}. {item.menu_name}</span><small>{number(item.quantity)}</small></span>) : <span className="w-menu-pill kpi-na">미산출</span>}</div></div>;
        })}</div>
      </section>
    </div>
  </div>;
}
