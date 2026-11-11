import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPnl, savePnlExpenses } from "../api/pnl";
import type { PnlLine, PnlResponse, Store } from "../types";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const pct = (p: string | null) => (p === null ? "-" : `${p}%`);

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

export function PnlPage({ store }: { store: Store }) {
  const [month, setMonth] = useState(thisMonth);
  const [draft, setDraft] = useState<Draft | null>(null);
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
        className="w-36 rounded border border-gray-300 px-2 py-1 text-right text-sm"
        placeholder={auto && l.source === "auto" ? String(l.amount) : auto ? "자동" : "0"}
        value={draft.values[l.code] ?? ""}
        onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [l.code]: e.target.value } })}
      />
    );
  };

  const maxTrend = Math.max(1, ...(pnl?.trend.flatMap((p) => [p.revenue, p.total_expenses]) ?? [1]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">손익</h1>
          <p className="text-sm text-gray-600">
            월별 약식 손익계산. 총매출·식자재 사입비·카드수수료는 자동으로 채우고, 나머지는 직접 입력합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100"
            onClick={() => changeMonth(shiftMonth(month, -1))}
            aria-label="이전 달"
          >
            ‹
          </button>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && changeMonth(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            aria-label="손익 월"
          />
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100"
            onClick={() => changeMonth(shiftMonth(month, 1))}
            aria-label="다음 달"
          >
            ›
          </button>
        </div>
      </div>

      {pnlQuery.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          손익을 불러오지 못했습니다: {(pnlQuery.error as Error).message}
        </div>
      )}

      {pnl && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs font-semibold text-gray-500">총매출</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">{won(pnl.revenue.amount)}</div>
              <div className="mt-1 text-xs text-gray-500">{AUTO_HINT.revenue}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs font-semibold text-gray-500">총지출</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">{won(pnl.total_expenses)}</div>
              <div className="mt-1 text-xs text-gray-500">
                매출 대비 {pct(pnl.revenue.amount ? ((pnl.total_expenses * 100) / pnl.revenue.amount).toFixed(1) : null)}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs font-semibold text-gray-500">영업이익</div>
              <div
                className={`mt-1 text-2xl font-bold ${pnl.operating_profit < 0 ? "text-red-700" : "text-gray-900"}`}
              >
                {won(pnl.operating_profit)}
              </div>
              <div className="mt-1 text-xs text-gray-500">영업이익률 {pct(pnl.operating_margin_percent)}</div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">{pnl.month} 약식 손익계산</h2>
              {draft ? (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">
                    카드수수료율{" "}
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step="0.01"
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                      value={draft.fee}
                      onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                    />
                    %
                  </label>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
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
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
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
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    onClick={() => saveMutation.mutate(draft)}
                  >
                    {saveMutation.isPending ? "저장 중…" : "저장"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                  onClick={() => setDraft(toDraft(pnl))}
                >
                  지출 입력
                </button>
              )}
            </div>
            {saveMutation.isError && (
              <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                저장 실패: {(saveMutation.error as Error).message}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">항목</th>
                    <th className="px-4 py-2 text-right font-semibold">금액</th>
                    <th className="px-4 py-2 text-right font-semibold">매출 대비</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pnl.expenses.map((l, i) => (
                    <tr key={`${l.code}-${i}`}>
                      <td className="px-4 py-2 text-gray-800">
                        {l.label}
                        {l.source === "auto" && (
                          <span
                            className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
                            title={AUTO_HINT[l.code]}
                          >
                            자동
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{amountCell(l)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-500">{pct(l.ratio_percent)}</td>
                    </tr>
                  ))}
                  {draft &&
                    draft.others.map((o, i) => (
                      <tr key={`new-other-${i}`} className="bg-amber-50/40">
                        <td className="px-4 py-2" colSpan={1}>
                          <input
                            aria-label="기타 항목 이름"
                            placeholder="기타 항목 이름"
                            maxLength={50}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                            value={o.label}
                            onChange={(e) => {
                              const others = [...draft.others];
                              others[i] = { ...o, label: e.target.value };
                              setDraft({ ...draft, others });
                            }}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            aria-label="기타 항목 금액"
                            className="w-36 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                            value={o.amount}
                            onChange={(e) => {
                              const others = [...draft.others];
                              others[i] = { ...o, amount: e.target.value };
                              setDraft({ ...draft, others });
                            }}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={() => setDraft({ ...draft, others: draft.others.filter((_, j) => j !== i) })}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 font-semibold">
                  {draft && (
                    <tr>
                      <td className="px-4 py-2" colSpan={3}>
                        <button
                          type="button"
                          className="text-xs font-semibold text-blue-700 hover:underline"
                          onClick={() => setDraft({ ...draft, others: [...draft.others, { label: "", amount: "" }] })}
                        >
                          + 기타 항목 추가
                        </button>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="px-4 py-2">총지출</td>
                    <td className="px-4 py-2 text-right tabular-nums">{won(pnl.total_expenses)}</td>
                    <td className="px-4 py-2" />
                  </tr>
                  <tr>
                    <td className="px-4 py-2">영업이익</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${pnl.operating_profit < 0 ? "text-red-700" : ""}`}
                    >
                      {won(pnl.operating_profit)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{pct(pnl.operating_margin_percent)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {draft && (
              <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
                자동 항목은 비워 두면 자동 값을 씁니다. 숫자를 넣으면 그 값으로 바꿉니다. 저장 전 표는 저장된 값 기준입니다.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold text-gray-900">최근 6개월</h2>
            <div className="mt-3 space-y-2">
              {pnl.trend.map((p) => (
                <div key={p.month} className="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-2 text-xs">
                  <span className="text-gray-600">{p.month}</span>
                  <div className="space-y-0.5">
                    <div className="h-2 rounded bg-blue-500" style={{ width: `${(p.revenue / maxTrend) * 100}%` }} />
                    <div className="h-2 rounded bg-gray-400" style={{ width: `${(p.total_expenses / maxTrend) * 100}%` }} />
                  </div>
                  <span className={`text-right tabular-nums ${p.operating_profit < 0 ? "text-red-700" : "text-gray-900"}`}>
                    {won(p.operating_profit)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-gray-500">
              <span>
                <span className="mr-1 inline-block h-2 w-3 rounded bg-blue-500" />
                총매출
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-3 rounded bg-gray-400" />
                총지출
              </span>
              <span>오른쪽 숫자: 영업이익</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
