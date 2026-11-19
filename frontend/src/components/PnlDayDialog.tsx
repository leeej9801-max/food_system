import { useQuery } from "@tanstack/react-query";
import { fetchPnlDay } from "../api/pnl";
import { Dialog } from "./Dialog";
import type { Store } from "../types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

const plus = (n: number) => `+${n.toLocaleString("ko-KR")}`;
const minus = (n: number) => `-${n.toLocaleString("ko-KR")}`;

/** 그날 매출(메뉴별)과 지출(입고 건별·카드수수료)을 한 표로 보여준다. */
export function PnlDayDialog({ store, day, onClose }: { store: Store; day: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["pnl-day", store.id, day],
    queryFn: () => fetchPnlDay(store.id, day),
  });
  const detail = query.data;

  return (
    <Dialog label={`${dayLabel(day)} 상세`} onClose={onClose}>
      <section className="card flex w-full max-w-[560px] flex-col gap-4">
        <div className="card-head">
          <h2>{dayLabel(day)}</h2>
          <button type="button" className="pill pill-soft" onClick={onClose}>
            닫기
          </button>
        </div>

        {query.isLoading && <p className="text-sm text-muted">불러오는 중…</p>}
        {query.isError && <p className="text-sm text-[#b42318]">불러오지 못했어요.</p>}

        {detail && (
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th className="py-2 font-medium">항목</th>
                <th className="py-2 text-right font-medium">수량</th>
                <th className="py-2 text-right font-medium">금액</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              <tr>
                <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold text-accent-700">
                  매출
                </td>
              </tr>
              {detail.sales.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-muted">
                    없음
                  </td>
                </tr>
              )}
              {detail.sales.map((s) => (
                <tr key={`${s.menu_item_id ?? ""}-${s.name}`}>
                  <td className="py-2">{s.name}</td>
                  <td className="py-2 text-right text-muted">{s.quantity}</td>
                  <td className="py-2 text-right text-accent-700">{plus(s.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold text-[#b42318]">
                  지출
                </td>
              </tr>
              {detail.receipts.map((r) => (
                <tr key={r.id}>
                  <td className="py-2">
                    {r.ingredient_name} 입고
                    {r.supplier_name && <span className="ml-1 text-xs text-muted">{r.supplier_name}</span>}
                  </td>
                  <td className="py-2 text-right text-muted">
                    {Number(r.quantity).toLocaleString("ko-KR")}
                    {r.unit}
                  </td>
                  <td className="py-2 text-right text-[#b42318]">{minus(r.amount)}</td>
                </tr>
              ))}
              {detail.card_fee > 0 && (
                <tr>
                  <td className="py-2">카드수수료 {Number(detail.card_fee_percent)}%</td>
                  <td className="py-2 text-right text-muted">추정</td>
                  <td className="py-2 text-right text-[#b42318]">{minus(detail.card_fee)}</td>
                </tr>
              )}
              {detail.receipts.length === 0 && detail.card_fee === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-muted">
                    없음
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-rule font-semibold">
                <td className="pt-3" colSpan={2}>
                  일손익
                </td>
                <td className={`pt-3 text-right ${detail.operating_profit < 0 ? "text-[#b42318]" : "text-accent-700"}`}>
                  {detail.operating_profit < 0 ? minus(-detail.operating_profit) : plus(detail.operating_profit)}원
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="pt-2 text-xs text-muted">
                  월 고정비(임대료·인건비 등)는 빠져 있어요.
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </Dialog>
  );
}
