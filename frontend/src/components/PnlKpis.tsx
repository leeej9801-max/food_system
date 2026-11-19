import { useId, useState } from "react";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { averageOrderValue, businessDayProgress, kpiDelta, manWon, shiftMonth, won } from "../lib/pnl";
import type { PnlResponse, Store } from "../types";

function Info({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip content={content} touchTrigger="tap" focusTrigger="always" hasHoverIndication={false}>
      <button type="button" className="pk-info" aria-label={`${label} 안내`}>i</button>
    </Tooltip>
  );
}

function Delta({ current, previous, expense = false, amountOnly = false, vs = "전월 동기" }: {
  current: number | null; previous: number | null; expense?: boolean; amountOnly?: boolean; vs?: string;
}) {
  const delta = kpiDelta(current, previous, amountOnly);
  const tone = delta.text === "미산출" || delta.direction === 0 ? "na" : (expense ? delta.direction < 0 : delta.direction > 0) ? "up" : "down";
  return <span className={`pk-delta pk-${tone}`}>{delta.text}<span className="pk-vs">{vs}</span></span>;
}

type Unit = "previous" | "weekly" | "monthly_average" | "weekly_average";
type Amounts = { revenue: number; expenses: number; operating_profit: number };

function compareOptions(pnl: PnlResponse) {
  return [
    { key: "previous", label: "전월", vs: "전월 동기", info: "이번 달 1일~오늘과 지난달 같은 날짜까지의 판매·입고·카드수수료를 비교해요. 날짜 없는 수기 월 비용은 제외해요. 과거 월은 월 전체를 비교해요." },
    { key: "weekly", label: "주", vs: "지난주 같은 요일", info: "이번 주 월요일~오늘과 지난주 월요일~같은 요일을 비교해요. 월 수기 금액은 달력 일수로 나눠 반영해요." },
    { key: "monthly_average", label: "월평균", vs: `${pnl.comparison.average_months}개월 평균`, info: `선택 월 값과 직전 ${pnl.comparison.average_months}개 완료월의 월평균을 비교해요. 현재 월은 진행 중이라 기간이 짧아요.` },
    { key: "weekly_average", label: "주평균", vs: "4주 평균", info: "이번 주 월요일~오늘과 직전 4개 완료주의 주평균을 비교해요. 이번 주는 진행 중이라 기간이 짧아요." },
  ] as const;
}

// 선택한 비교 기준의 현재값·기준값. 전월은 기존 전월 동기 규칙을 그대로 쓴다.
function comparePair(pnl: PnlResponse, unit: Unit): { current: Amounts | null; baseline: Amounts | null } {
  const cmp = pnl.comparison;
  if (unit !== "previous") return cmp[unit];
  const old = cmp.previous_month;
  return {
    current: cmp.to_date ?? { revenue: pnl.revenue.amount, expenses: pnl.total_expenses, operating_profit: pnl.operating_profit },
    baseline: (cmp.to_date ? pnl.kpi.previous_to_date_has_data : pnl.kpi.previous_has_data)
      ? cmp.previous_to_date ?? { revenue: old.revenue, expenses: old.total_expenses, operating_profit: old.operating_profit } : null,
  };
}

function CompareTabs({ pnl, unit, onChange }: { pnl: PnlResponse; unit: Unit; onChange: (unit: Unit) => void }) {
  const options = compareOptions(pnl);
  const chosen = options.find((option) => option.key === unit)!;
  return (
    <div className="pk-ctabs" role="group" aria-label="비교 기준">
      {options.map((option) => <button key={option.key} type="button" aria-pressed={unit === option.key} onClick={() => onChange(option.key)}>{option.label}</button>)}
      <Info label={`${chosen.vs} 비교`} content={chosen.info} />
    </div>
  );
}

function Value({ amount }: { amount: number | null }) {
  return <div className="pk-value">{amount === null ? "미산출" : <>{amount.toLocaleString("ko-KR")}<small>원</small></>}</div>;
}

function DayBars({ yesterday, today }: { yesterday: number | null; today: number | null }) {
  const max = Math.max(1, yesterday ?? 0, today ?? 0);
  return (
    <div className="pk-dd" aria-label="어제 전체와 오늘 수집분 비교">
      {[yesterday, today].map((amount, index) => (
        <div key={index} className={index ? "pk-today" : undefined}>
          <span className="pk-v2">{amount === null ? "미산출" : manWon(amount, 2)}</span>
          <div className="pk-b" style={{ height: `${Math.max(0, amount ?? 0) / max * 58}px` }} />
          {index ? "오늘" : "어제"}
        </div>
      ))}
    </div>
  );
}

function Trend({ pnl, onPick }: { pnl: PnlResponse; onPick: (month: string) => void }) {
  const [metric, setMetric] = useState<"revenue" | "operating_profit">("revenue");
  const target = metric === "revenue" && (pnl.goal.revenue_target ?? 0) > 0 ? pnl.goal.revenue_target : null;
  const values = pnl.trend.map((point) => point[metric]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, target ?? 0, ...values) * 1.1;
  const range = max - min;
  const height = 116;
  const zero = -min / range * height;
  return (
    <section className="pk-card pk-trend" aria-label="최근 6개월 추이">
      <div className="pk-trend-head">
        <h2 className="pk-label">최근 6개월</h2>
        <div className="pk-trend-controls">
          {target !== null && <span className="pk-goal-key"><i />목표</span>}
          <div className="pk-seg" role="group" aria-label="추이 지표">
            <button type="button" aria-pressed={metric === "revenue"} onClick={() => setMetric("revenue")}>매출</button>
            <button type="button" aria-pressed={metric === "operating_profit"} onClick={() => setMetric("operating_profit")}>이익</button>
          </div>
        </div>
      </div>
      <div className="pk-plot">
        {target !== null && <div className="pk-gline" style={{ bottom: `${(target - min) / range * height + 19}px` }}><span>목표 {manWon(target)}</span></div>}
        {min < 0 && <div className="pk-zero" style={{ bottom: `${zero + 19}px` }} />}
        <div className="pk-bars">
          {pnl.trend.map((point) => {
            const amount = point[metric];
            const now = point.month === pnl.kpi.today.date.slice(0, 7);
            const below = target !== null && amount < target;
            const barHeight = Math.abs(amount) / range * height;
            return (
              <button type="button" key={point.month} className={`pk-bar${below ? " pk-below" : ""}${now ? " pk-now" : ""}${amount < 0 ? " pk-negative" : ""}`}
                aria-label={`${point.month} ${metric === "revenue" ? "매출" : "영업이익"} ${won(amount)}${now ? ", 진행 중" : ""}`}
                onClick={() => onPick(point.month)}>
                <span className="pk-amt" style={{ bottom: `${19 + zero + (amount >= 0 ? barHeight : 0) + 4}px` }}>{manWon(amount)}</span>
                <span className="pk-col" style={{ height: `${barHeight}px`, bottom: `${19 + zero - (amount < 0 ? barHeight : 0)}px` }} />
                <span className="pk-month">{Number(point.month.slice(5))}월{now ? " · 진행 중" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Goal({ pnl, store, onEdit }: { pnl: PnlResponse; store: Store; onEdit: () => void }) {
  const gradientId = useId();
  const target = pnl.goal.revenue_target;
  const actual = pnl.revenue.amount;
  const rate = target && target > 0 ? actual / target * 100 : null;
  const days = businessDayProgress(pnl.month, store.business_days, pnl.kpi.today.date);
  const remaining = target === null ? 0 : Math.max(0, target - actual);
  const needed = days && days.remaining > 0 ? Math.ceil(remaining / days.remaining) : remaining === 0 ? 0 : null;
  const previousDays = businessDayProgress(shiftMonth(pnl.month, -1), store.business_days, pnl.kpi.today.date);
  const usual = pnl.kpi.previous_has_data && previousDays?.total
    ? Math.round(pnl.comparison.previous_month.revenue / previousDays.total)
    : days?.elapsed ? Math.round(actual / days.elapsed) : null;
  const difference = rate !== null && days?.expected !== null && days?.expected !== undefined ? rate - days.expected : null;
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return (
    <aside className="pk-card pk-goal" aria-label="매출 목표">
      <div className="pk-goal-top">
        <h2 className="pk-label">매출 목표 <Info label="매출 목표" content={target !== null ? `적용 목표 ${won(target)}.${pnl.goal.inherited_from ? ` ${pnl.goal.inherited_from.replace("-", "년 ")}월 목표를 이어받았어요.` : ""} 설정하지 않은 달은 직전 달 목표를 따라요.` : "이번 달 목표를 설정해 주세요. 다음 달엔 이 목표를 이어받아요."} /></h2>
        <button type="button" className="pk-info" aria-label="목표 수정" onClick={onEdit}>↗</button>
      </div>
      {rate === null ? (
        <div className="pk-goal-empty"><p>이번달 목표액 설정을 해주세요</p><button type="button" className="pill pill-secondary" onClick={onEdit}>목표 설정</button></div>
      ) : (
        <>
          <div className="pk-gauge" role="img" aria-label={`매출 목표 달성률 ${rate.toFixed(1)}%`}>
            <svg width="260" height="150" viewBox="0 0 260 150" aria-hidden="true">
              <defs><linearGradient id={gradientId} x1="0" x2="1"><stop offset="0" stopColor="#7fb2ff" /><stop offset="1" stopColor="#5ff0d8" /></linearGradient></defs>
              <path d="M20 140 A110 110 0 0 1 240 140" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="18" strokeLinecap="round" />
              {rate > 0 && <path d="M20 140 A110 110 0 0 1 240 140" fill="none" stroke={`url(#${gradientId})`} strokeWidth="18" strokeLinecap="round" strokeDasharray="345.6" strokeDashoffset={345.6 * (1 - clamp(rate) / 100)} />}
            </svg>
            <div className="pk-gauge-c"><div className="pk-pct">{rate.toFixed(1)}%</div><div className="pk-frac"><b>{manWon(actual)}원</b><span>{manWon(target!)}원</span></div></div>
          </div>
          <div className="pk-mini-row">
            <div className="pk-mini"><div className="pk-label">남은 금액</div><div className="pk-v">{won(remaining)}</div><div className="pk-s">{days ? `남은 영업일 ${days.remaining}일` : "영업일 미설정"}</div></div>
            <div className="pk-mini"><div className="pk-label">하루 필요 매출</div><div className="pk-v">{needed === null ? "미산출" : won(needed)}</div><div className="pk-s">평소 하루 {usual === null ? "미산출" : won(usual)}</div></div>
          </div>
          <div className="pk-pace">
            <div className="pk-pace-row"><span>진도 <Info label="영업일 진도" content="예상 매출은 경과 영업일 ÷ 이번 달 전체 영업일이에요. 남은 영업일은 내일부터 세며, 평소 하루는 지난달 매출 ÷ 영업일(지난달 기록이 없으면 이번 달 경과 영업일)이에요." /></span><b>{difference === null ? "영업일 미설정" : Math.abs(difference) < 0.05 ? "목표 진도와 같아요" : `목표보다 ${Math.abs(difference).toFixed(1)}%p ${difference > 0 ? "앞서요" : "뒤처져요"}`}</b></div>
            <div className="pk-pace-bar"><div className="pk-fill" style={{ width: `${clamp(rate)}%` }} />{days?.expected !== null && days?.expected !== undefined && <div className="pk-mark" style={{ left: `${clamp(days.expected)}%` }} />}</div>
            <div className="pk-pace-row pk-pace-legend"><span><i className="pk-dot" />현재 매출 {Math.round(rate)}%</span><span className="pk-exp"><i className="pk-dot" />예상 매출 {days?.expected === null || days?.expected === undefined ? "미산출" : `${Math.round(days.expected)}%`}</span></div>
          </div>
        </>
      )}
      <div className="pk-goal-profit">영업이익 목표 {pnl.goal.profit_target === null ? "미설정" : won(pnl.goal.profit_target)}</div>
    </aside>
  );
}

export function PnlKpis({ pnl, store, onEditGoal, onPickMonth }: {
  pnl: PnlResponse; store: Store; onEditGoal: () => void; onPickMonth: (month: string) => void;
}) {
  const { comparison, kpi } = pnl;
  const [unit, setUnit] = useState<Unit>("previous");
  const pair = comparePair(pnl, unit);
  const vs = compareOptions(pnl).find((option) => option.key === unit)!.vs;
  const current = comparison.to_date;
  const previous = comparison.previous_to_date;
  // 날짜 없는 월 수기 지출은 전월 동기 비교에 포함하지 않는다.
  const hasPrevious = current ? kpi.previous_to_date_has_data : kpi.previous_has_data;
  const currentRevenue = current?.revenue ?? pnl.revenue.amount;
  const previousRevenue = hasPrevious ? previous?.revenue ?? comparison.previous_month.revenue : null;
  const orders = current ? kpi.to_date_order_count ?? 0 : kpi.order_count;
  const previousOrders = current ? kpi.previous_to_date_order_count ?? 0 : kpi.previous_order_count;
  const previousMargin = kpi.previous_has_data && comparison.previous_month.revenue !== 0
    ? comparison.previous_month.operating_profit / comparison.previous_month.revenue * 100 : null;
  const margin = pnl.operating_margin_percent === null ? null : Number(pnl.operating_margin_percent);
  const marginDiff = margin !== null && previousMargin !== null ? margin - previousMargin : null;
  const groups = [
    { label: "재료비", codes: ["ingredients", "liquor"], color: "#2f6bff" },
    { label: "인건비", codes: ["labor", "social_insurance"], color: "#1aa9a0" },
    { label: "임대료", codes: ["rent"], color: "#0f2a66" },
    { label: "기타", codes: [], color: "#b8c4dc" },
  ];
  const namedCodes = groups.flatMap((group) => group.codes);
  const breakdown = groups.map((group) => ({ ...group, amount: pnl.expenses.filter((line) => group.codes.length ? group.codes.includes(line.code) : !namedCodes.includes(line.code)).reduce((sum, line) => sum + line.amount, 0) }));
  const total = breakdown.reduce((sum, group) => sum + group.amount, 0);
  return (
    <div className="pnl-kpi-container">
    <div className="pnl-kpi-grid">
      <section className="pk-card pk-hero" aria-label="영업이익">
        <div className="pk-hero-top"><h2 className="pk-label">영업이익 <Info label="영업이익" content="총매출 − 총지출. 재료비는 입고 금액 기준이라 실제 사용량과 다를 수 있어요. 전월 동기는 날짜가 있는 판매·입고·카드수수료만 비교해요." /></h2><CompareTabs pnl={pnl} unit={unit} onChange={setUnit} /></div>
        <Value amount={pnl.operating_profit} />
        <Delta amountOnly vs={vs} current={pair.current?.operating_profit ?? null} previous={pair.baseline?.operating_profit ?? null} />
        <div className="pk-meta">
          <div>이익률<b>{margin === null ? "미산출" : `${margin.toFixed(1)}%`}</b></div>
          <div>지난달<b>{previousMargin === null ? "미산출" : `${previousMargin.toFixed(1)}%`}</b></div>
          <div>지난달 대비<b>{marginDiff === null ? "미산출" : `${marginDiff >= 0 ? "+" : ""}${marginDiff.toFixed(1)}%p`}</b></div>
        </div>
        <svg className="pk-wave" width="220" height="70" viewBox="0 0 220 70" aria-hidden="true"><path d="M0 55 C30 40 50 60 80 42 S130 20 160 30 S200 12 220 8" fill="none" stroke="#fff" strokeWidth="3" /></svg>
      </section>
      <div className="pk-split">
        <section className="pk-card">
          <div><h2 className="pk-label">총매출 <Info label="총매출" content="POS·CSV로 들어온 판매 합계예요. 월 수기 매출이 있으면 우선 표시해요. 어제 전체 매출과 오늘 수집된 매출을 비교하며 업로드 모드도 같아요." /></h2><Value amount={pnl.revenue.amount} /><Delta vs={vs} current={pair.current?.revenue ?? null} previous={pair.baseline?.revenue ?? null} /></div>
          <DayBars yesterday={kpi.yesterday.revenue} today={kpi.today.revenue} />
        </section>
        <section className="pk-card">
          <div><h2 className="pk-label">객단가 <Info label="객단가" content={`총매출 ÷ 주문 건수. 이번 달 완료 주문 ${kpi.order_count.toLocaleString("ko-KR")}건. 완료 품목이 있는 주문을 한 번씩 세며, 주문 기록이 없으면 미산출이에요.`} /></h2><Value amount={averageOrderValue(pnl.revenue.amount, kpi.order_count)} /><Delta current={averageOrderValue(currentRevenue, orders)} previous={previousRevenue === null ? null : averageOrderValue(previousRevenue, previousOrders)} /></div>
          <DayBars yesterday={averageOrderValue(kpi.yesterday.revenue, kpi.yesterday.order_count)} today={averageOrderValue(kpi.today.revenue, kpi.today.order_count)} />
        </section>
      </div>
      <section className="pk-card pk-spend" aria-label="총지출">
        <h2 className="pk-label">총지출 <Info label="총지출" content="재료비(식자재·주류 사입비) + 인건비(4대보험 포함) + 임대료 + 기타(카드수수료 등). 전월 동기는 날짜 있는 입고·카드수수료만 비교해요." /></h2>
        <Value amount={pnl.total_expenses} />
        <Delta expense vs={vs} current={pair.current?.expenses ?? null} previous={pair.baseline?.expenses ?? null} />
        <div className="pk-stack" aria-hidden="true">{breakdown.map((group) => <span key={group.label} style={{ width: `${total ? group.amount / total * 100 : 0}%`, background: group.color }} />)}</div>
        <div className="pk-legend">{breakdown.map((group) => <span key={group.label}><i style={{ background: group.color }} />{group.label} {total ? `${Math.round(group.amount / total * 100)}%` : "미산출"}</span>)}</div>
      </section>
      <Goal pnl={pnl} store={store} onEdit={onEditGoal} />
      <Trend pnl={pnl} onPick={onPickMonth} />
    </div>
    </div>
  );
}
