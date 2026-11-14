import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPnl, savePnlExpenses } from "../api/pnl";
import { HeroKpi } from "../components/HeroKpi";
import type { PnlLine, PnlResponse, Store } from "../types";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const pct = (p: string | null) => (p === null ? "-" : `${p}%`);

// 지난달 대비 영업이익 증감 (trend 끝 두 달). 지난달 값이 0이면 표시하지 않는다.
function profitDelta(trend: { operating_profit: number }[]): string | undefined {
  if (trend.length < 2) return undefined;
  const prev = trend[trend.length - 2].operating_profit;
  const cur = trend[trend.length - 1].operating_profit;
  if (prev === 0) return undefined;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}%`;
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 편집 중 값: 항목 코드 → 입력 문자열. 빈 문자열이면 자동 값(있으면)으로 돌아간다.
type Draft = { values: Record<string, string>; others: { label: string; amount: string }[]; fee: string };

function toDraft(pnl: PnlResponse): Draft {
  const values: Record<string, string> = {};
  for (const l of pnl.expenses) {
    if (l.code !== "other" && l.source === "manual" && (l.amount !== 0 || l.code in AUTO_HINT)) values[l.code] = String(l.amount);
  }
  return {
    values,
    others: pnl.expenses
      .filter((l) => l.code === "other")
      .map((l) => ({ label: l.label, amount: String(l.amount) })),
    fee: pnl.card_fee_percent,
  };
}

const AUTO_HINT: Record<string, string> = {
  revenue: "판매 기록(취소 제외) 합계",
  ingredients: "그 달 입고 금액 합계",
  card_fee: "총매출 × 카드수수료율",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function PnlCalendar({ days }: { days: PnlResponse["daily"] }) {
  if (days.length === 0) return null;
  const [y, m] = days[0].date.split("-").map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  return (
    <section className="card">
      <div className="card-head">
        <h2>일별 매출 · 지출</h2>
        <span className="card-meta">{y}.{String(m).padStart(2, "0")}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center font-medium text-muted">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {days.map((d) => (
          <div key={d.date} className="min-h-16 min-w-0 rounded-xl bg-ground p-2">
            {/* 날씨 아이콘 자리(왼쪽 위): 날씨 API 연결 후 날짜 앞에 넣는다 */}
            <div className="text-muted tabular-nums">{Number(d.date.slice(8))}</div>
            {d.revenue > 0 && (
              <div className="mt-0.5 truncate text-right font-medium text-accent-700 tabular-nums">
                +{d.revenue.toLocaleString("ko-KR")}
              </div>
            )}
            {d.expenses > 0 && (
              <div className="truncate text-right font-medium text-[#b42318] tabular-nums">
                -{d.expenses.toLocaleString("ko-KR")}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PnlPage({ store }: { store: Store }) {
  const [month, setMonth] = useState(thisMonth);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const pnlQuery = useQuery({
    queryKey: ["pnl", store.id, month],
    queryFn: () => fetchPnl(store.id, month),
  });

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      savePnlExpenses(store.id, month, {
        items: [
          ...Object.entries(d.values)
            .filter(([, v]) => v.trim() !== "")
            .map(([code, v]) => ({ code, amount: Number(v) })),
          ...d.others
            .filter((o) => o.label.trim() !== "" || o.amount.trim() !== "")
            .map((o) => ({ code: "other", label: o.label.trim(), amount: Number(o.amount || 0) })),
        ],
        card_fee_percent: d.fee,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["pnl", store.id, month], data);
      void queryClient.invalidateQueries({ queryKey: ["pnl", store.id] });
      setDraft(null);
    },
  });

  const pnl = pnlQuery.data;
  const changeMonth = (m: string) => {
    setMonth(m);
    setDraft(null);
    saveMutation.reset();
  };

  const amountCell = (l: PnlLine) => {
    if (!draft || l.code === "other") return won(l.amount);
    const auto = AUTO_HINT[l.code];
    return (
      <input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={`${l.label} 금액`}
        className="h-9 w-36 rounded-lg bg-ground px-3 text-right text-sm text-ink tabular-nums"
        placeholder={auto && l.source === "auto" ? String(l.amount) : auto ? "자동" : "0"}
        value={draft.values[l.code] ?? ""}
        onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [l.code]: e.target.value } })}
      />
    );
  };

  const expanded = open || draft !== null;
  const maxTrend = Math.max(1, ...(pnl?.trend.flatMap((p) => [p.revenue, p.total_expenses]) ?? [1]));

  return (
    <div>
      <div className="page-heading">
        <div className="page-title">
          <h1>손익</h1>
          <span className="title-divider" />
          <span className="title-meta">{month}</span>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="pill pill-sm pill-secondary"
            onClick={() => changeMonth(shiftMonth(month, -1))}
            aria-label="이전 달"
          >
            ‹
          </button>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && changeMonth(e.target.value)}
            className="pill pill-sm pill-secondary tabular-nums"
            aria-label="손익 월"
          />
          <button
            type="button"
            className="pill pill-sm pill-secondary"
            onClick={() => changeMonth(shiftMonth(month, 1))}
            aria-label="다음 달"
          >
            ›
          </button>
        </div>
      </div>

      {pnlQuery.isError && (
        <div className="mb-4 rounded-2xl bg-[#fdecec] px-4 py-3 text-sm text-[#b42318]">
          손익을 불러오지 못했습니다: {(pnlQuery.error as Error).message}
        </div>
      )}

      {pnl && (
        <div className="flex flex-col gap-4 xl:gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 xl:gap-5">
            <HeroKpi
              label="영업이익"
              value={pnl.operating_profit.toLocaleString("ko-KR")}
              unit="원"
              tone={pnl.operating_profit < 0 ? "alert" : "normal"}
              delta={profitDelta(pnl.trend)}
            >
              {profitDelta(pnl.trend) ? "지난달 대비 · " : ""}영업이익률 {pct(pnl.operating_margin_percent)}
            </HeroKpi>

            <section className="card">
              <div className="kpi-label">총매출</div>
              <div className="kpi-value">
                {pnl.revenue.amount.toLocaleString("ko-KR")}
                <small>원</small>
              </div>
              <div className="kpi-sub">판매 합계</div>
            </section>

            <section className="card">
              <div className="kpi-label">총지출</div>
              <div className="kpi-value">
                {pnl.total_expenses.toLocaleString("ko-KR")}
                <small>원</small>
              </div>
              <div className="kpi-sub">
                매출 대비 {pct(pnl.revenue.amount ? ((pnl.total_expenses * 100) / pnl.revenue.amount).toFixed(1) : null)}
              </div>
            </section>

            <section className="card">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-ink">최근 6개월</span>
                <span className="flex gap-2 text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-accent-600" />
                    매출
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-accent-300" />
                    지출
                  </span>
                </span>
              </div>
              <div className="mt-3 flex gap-1.5">
                {pnl.trend.map((p) => (
                  <div
                    key={p.month}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                    title={`${p.month} 매출 ${won(p.revenue)} · 지출 ${won(p.total_expenses)}`}
                  >
                    <div className="flex h-16 w-full items-end justify-center gap-1 rounded-lg bg-ground px-1 pt-1">
                      <div
                        className="w-2 rounded-t-sm bg-accent-600"
                        style={{ height: `${Math.max(4, (p.revenue / maxTrend) * 100)}%` }}
                      />
                      <div
                        className="w-2 rounded-t-sm bg-accent-300"
                        style={{ height: `${Math.max(4, (p.total_expenses / maxTrend) * 100)}%` }}
                      />
                    </div>
                    <span
                      className={`text-[11px] tabular-nums ${
                        p.month === pnl.month ? "font-semibold text-ink" : "text-muted"
                      }`}
                    >
                      {Number(p.month.slice(5))}월
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-head flex-wrap">
              <button
                type="button"
                aria-expanded={expanded}
                disabled={draft !== null}
                className="flex items-center gap-2 text-base font-semibold tracking-[-0.4px] text-ink"
                onClick={() => setOpen(!open)}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : "-rotate-90"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                {pnl.month} 약식 손익계산
              </button>
              {draft ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    카드수수료율{" "}
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step="0.01"
                      className="h-9 w-20 rounded-lg bg-ground px-2 text-right text-sm text-ink tabular-nums"
                      value={draft.fee}
                      onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                    />
                    %
                  </label>
                  <button
                    type="button"
                    className="pill pill-sm pill-soft"
                    onClick={async () => {
                      // 고정비용: 지난달 수기 값을 그대로 가져온다. 자동 항목(입고·카드수수료)은 건드리지 않는다.
                      const prev = toDraft(await fetchPnl(store.id, shiftMonth(month, -1)));
                      const values = { ...draft.values };
                      for (const [code, v] of Object.entries(prev.values)) {
                        if (!(code in AUTO_HINT)) values[code] = v;
                      }
                      setDraft({ ...draft, values, others: [...draft.others, ...prev.others] });
                    }}
                  >
                    지난달 값 복사
                  </button>
                  <button
                    type="button"
                    className="pill pill-sm pill-soft"
                    onClick={() => {
                      setDraft(null);
                      saveMutation.reset();
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={saveMutation.isPending}
                    className="pill pill-sm pill-primary"
                    onClick={() => saveMutation.mutate(draft)}
                  >
                    {saveMutation.isPending ? "저장 중…" : "저장"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="pill pill-sm pill-soft"
                  onClick={() => setDraft(toDraft(pnl))}
                >
                  지출 입력
                </button>
              )}
            </div>

            {saveMutation.isError && (
              <div className="mb-3 rounded-xl bg-[#fdecec] px-4 py-2 text-sm text-[#b42318]">
                저장 실패: {(saveMutation.error as Error).message}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="data-table">
                {expanded && (
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th className="!text-right">금액</th>
                      <th className="!text-right">매출 대비</th>
                    </tr>
                  </thead>
                )}
                {expanded && (
                  <tbody>
                    {pnl.expenses.map((l, i) => (
                      <tr key={`${l.code}-${i}`}>
                        <td>
                          <span className="font-medium text-ink">{l.label}</span>
                          {l.source === "auto" && (
                            <span className="chip chip-ok ml-2" title={AUTO_HINT[l.code]}>
                              자동
                            </span>
                          )}
                        </td>
                        <td className="!text-right tabular-nums">{amountCell(l)}</td>
                        <td className="!text-right text-muted tabular-nums">{pct(l.ratio_percent)}</td>
                      </tr>
                    ))}
                    {draft &&
                      draft.others.map((o, i) => (
                        <tr key={`new-other-${i}`}>
                          <td>
                            <input
                              aria-label="기타 항목 이름"
                              placeholder="기타 항목 이름"
                              maxLength={50}
                              className="h-9 w-full rounded-lg bg-ground px-3 text-sm text-ink"
                              value={o.label}
                              onChange={(e) => {
                                const others = [...draft.others];
                                others[i] = { ...o, label: e.target.value };
                                setDraft({ ...draft, others });
                              }}
                            />
                          </td>
                          <td className="!text-right">
                            <input
                              type="number"
                              min={0}
                              aria-label="기타 항목 금액"
                              className="h-9 w-36 rounded-lg bg-ground px-3 text-right text-sm text-ink tabular-nums"
                              value={o.amount}
                              onChange={(e) => {
                                const others = [...draft.others];
                                others[i] = { ...o, amount: e.target.value };
                                setDraft({ ...draft, others });
                              }}
                            />
                          </td>
                          <td className="!text-right">
                            <button
                              type="button"
                              className="pill pill-sm pill-soft text-[#b42318]"
                              onClick={() => setDraft({ ...draft, others: draft.others.filter((_, j) => j !== i) })}
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                )}
                <tfoot className={`font-semibold ${expanded ? "border-t border-rule" : ""}`}>
                  {draft && (
                    <tr>
                      <td colSpan={3} className="py-2">
                        <button
                          type="button"
                          className="pill pill-sm pill-soft"
                          onClick={() => setDraft({ ...draft, others: [...draft.others, { label: "", amount: "" }] })}
                        >
                          + 기타 항목 추가
                        </button>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>총지출</td>
                    <td className="!text-right tabular-nums">{won(pnl.total_expenses)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td>영업이익</td>
                    <td
                      className={`!text-right tabular-nums ${
                        pnl.operating_profit < 0 ? "!text-[#b42318]" : ""
                      }`}
                    >
                      {won(pnl.operating_profit)}
                    </td>
                    <td className="!text-right tabular-nums">{pct(pnl.operating_margin_percent)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <PnlCalendar days={pnl.daily} />
        </div>
      )}
    </div>
  );
}
