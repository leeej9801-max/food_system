import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPnl, savePnlExpenses } from "../api/pnl";
import { Dialog } from "./Dialog";
import { pct, shiftMonth, won } from "../lib/pnl";
import type { PnlLine, PnlResponse, Store } from "../types";

// 편집 중 값: 항목 코드 → 입력 문자열. 빈 문자열이면 자동 값(있으면)으로 돌아간다.
type Draft = { values: Record<string, string>; others: { label: string; amount: string }[]; fee: string };

// 자동으로 채워지는 항목과 그 출처 이름
const SOURCE_LABEL: Record<string, string> = {
  revenue: "판매 집계",
  ingredients: "입고 합계",
  card_fee: "수수료 추정",
};

function toDraft(pnl: PnlResponse): Draft {
  const values: Record<string, string> = {};
  for (const l of pnl.expenses) {
    if (l.code !== "other" && l.source === "manual" && (l.amount !== 0 || l.code in SOURCE_LABEL)) {
      values[l.code] = String(l.amount);
    }
  }
  return {
    values,
    others: pnl.expenses
      .filter((l) => l.code === "other")
      .map((l) => ({ label: l.label, amount: String(l.amount) })),
    fee: pnl.card_fee_percent,
  };
}

const inputClass = "h-9 rounded-lg bg-ground px-3 text-sm text-ink tabular-nums";

export function PnlStatementDialog({
  store,
  pnl,
  onClose,
}: {
  store: Store;
  pnl: PnlResponse;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const month = pnl.month;

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => {
      const amounts = [...Object.values(d.values), ...d.others.map((o) => o.amount)].filter((v) => v.trim() !== "");
      if (amounts.some((v) => !Number.isFinite(Number(v)) || Number(v) < 0)) {
        return Promise.reject(new Error("금액은 0 이상의 숫자로 입력해 주세요."));
      }
      return savePnlExpenses(store.id, month, {
        items: [
          ...Object.entries(d.values)
            .filter(([, v]) => v.trim() !== "")
            .map(([code, v]) => ({ code, amount: Number(v) })),
          ...d.others
            .filter((o) => o.label.trim() !== "" || o.amount.trim() !== "")
            .map((o) => ({ code: "other", label: o.label.trim(), amount: Number(o.amount || 0) })),
        ],
        card_fee_percent: d.fee,
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["pnl", store.id, month], data);
      void queryClient.invalidateQueries({ queryKey: ["pnl", store.id] });
      setDraft(null);
    },
  });

  const close = () => {
    if (draft && !window.confirm("저장하지 않은 입력이 있어요. 닫을까요?")) return;
    onClose();
  };

  const copyLastMonth = async (d: Draft) => {
    setCopyError(null);
    try {
      // 고정비용: 지난달 수기 값으로 덮는다. 자동 항목(입고·카드수수료)은 건드리지 않는다.
      const prev = toDraft(await fetchPnl(store.id, shiftMonth(month, -1)));
      const values = { ...d.values };
      for (const [code, v] of Object.entries(prev.values)) {
        if (!(code in SOURCE_LABEL)) values[code] = v;
      }
      setDraft({ ...d, values, others: prev.others });
    } catch (e) {
      setCopyError((e as Error).message);
    }
  };

  const amountCell = (l: PnlLine) => {
    if (!draft || l.code === "other") {
      return <span className={l.amount === 0 ? "text-muted" : ""}>{won(l.amount)}</span>;
    }
    const auto = SOURCE_LABEL[l.code];
    return (
      <input
        type="number"
        min={0}
        inputMode="numeric"
        aria-label={`${l.label} 금액`}
        className={`${inputClass} w-36 text-right`}
        placeholder={auto && l.source === "auto" ? String(l.amount) : auto ? "자동" : "0"}
        value={draft.values[l.code] ?? ""}
        onChange={(e) => setDraft({ ...draft, values: { ...draft.values, [l.code]: e.target.value } })}
      />
    );
  };

  const sourceChip = (l: PnlLine) =>
    l.source === "auto" && SOURCE_LABEL[l.code] ? (
      <span className="chip chip-ok ml-2">{SOURCE_LABEL[l.code]}</span>
    ) : null;

  return (
    <Dialog label="손익계산" onClose={close}>
      <section className="card pnl-statement-dialog" aria-label="손익계산 상세">
        <div className="card-head !mb-0 shrink-0 flex-wrap">
          <h2>손익계산</h2>
          <div className="flex flex-wrap items-center gap-2">
            {draft ? (
              <>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  카드수수료율
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step="0.01"
                    className={`${inputClass} w-20 text-right`}
                    value={draft.fee}
                    onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
                  />
                  %
                </label>
                <button type="button" className="pill pill-sm pill-soft" onClick={() => void copyLastMonth(draft)}>
                  지난달 값 복사
                </button>
                <button
                  type="button"
                  className="pill pill-sm pill-soft"
                  onClick={() => {
                    setDraft(null);
                    setCopyError(null);
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
              </>
            ) : (
              <>
                <button type="button" className="pill pill-sm pill-primary" onClick={() => setDraft(toDraft(pnl))}>
                  지출 입력
                </button>
                <button type="button" className="pill pill-sm pill-soft" onClick={close}>
                  닫기
                </button>
              </>
            )}
          </div>
        </div>

        {(saveMutation.isError || copyError) && (
          <div className="shrink-0 rounded-xl bg-[#fdecec] px-4 py-2 text-sm text-[#b42318]">
            {saveMutation.isError ? `저장 실패: ${(saveMutation.error as Error).message}` : `지난달 값을 불러오지 못했어요: ${copyError}`}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>항목</th>
                <th className="!text-right">금액</th>
                <th className="!text-right">매출 대비</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-semibold">
                <td>
                  <span className="text-ink">{pnl.revenue.label}</span>
                  {sourceChip(pnl.revenue)}
                </td>
                <td className="!text-right tabular-nums">{won(pnl.revenue.amount)}</td>
                <td className="!text-right text-muted tabular-nums">100%</td>
              </tr>
              {pnl.expenses.map((l, i) => (
                <tr key={`${l.code}-${i}`}>
                  <td>
                    <span className="font-medium text-ink">{l.label}</span>
                    {sourceChip(l)}
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
                        className={`${inputClass} w-full`}
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
                        className={`${inputClass} w-36 text-right`}
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
            <tfoot className="border-t border-rule font-semibold">
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
                <td className={`!text-right tabular-nums ${pnl.operating_profit < 0 ? "!text-[#b42318]" : ""}`}>
                  {won(pnl.operating_profit)}
                </td>
                <td className="!text-right tabular-nums">{pct(pnl.operating_margin_percent)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </Dialog>
  );
}
