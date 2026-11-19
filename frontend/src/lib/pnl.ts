export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
export const pct = (p: string | null) => (p === null ? "-" : `${p}%`);

const pad = (n: number) => String(n).padStart(2, "0");

export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatKoreanMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

// 기준 대비 증감률. 기준이 0이면 비율이 의미 없어 표시하지 않는다.
export function changeRate(cur: number, prev: number): string | undefined {
  if (prev === 0 || !Number.isFinite(cur) || !Number.isFinite(prev)) return undefined;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(d)) return undefined;
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}%`;
}

// 목표 달성률(%). 목표가 없거나 0 이하면 null.
export function achievement(actual: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  return Math.round((actual / target) * 100);
}

// 작은 기준이나 적자↔흑자 전환은 비율 대신 차액을 보여 준다.
export function kpiDelta(current: number | null, previous: number | null, amountOnly = false) {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { text: "미산출", direction: 0 };
  }
  const difference = current - previous;
  const amount = amountOnly || previous === 0 || Math.abs(previous) < Math.abs(current) * 0.1 || current * previous < 0;
  const direction = Math.sign(difference);
  const value = amount ? won(Math.round(Math.abs(difference))) : `${Math.abs(difference / Math.abs(previous) * 100).toFixed(1)}%`;
  return { text: `${direction > 0 ? "▲" : direction < 0 ? "▼" : "−"} ${value}`, direction };
}

export const averageOrderValue = (revenue: number, orders: number) => orders > 0 ? Math.round(revenue / orders) : null;
export const manWon = (amount: number, digits = 0) => `${(amount / 10000).toLocaleString("ko-KR", { maximumFractionDigits: digits })}만`;

export function businessDayProgress(month: string, businessDays: string | null, today: string) {
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const open = businessDays?.split(",").map((day) => day.trim()).filter((day) => weekdays.includes(day));
  if (!open?.length) return null;
  const [year, number] = month.split("-").map(Number);
  let total = 0;
  let elapsed = 0;
  for (let day = 1; day <= new Date(year, number, 0).getDate(); day++) {
    if (!open.includes(weekdays[new Date(year, number - 1, day).getDay()])) continue;
    total++;
    if (`${month}-${pad(day)}` <= today) elapsed++;
  }
  return { total, elapsed, remaining: total - elapsed, expected: total ? elapsed / total * 100 : null };
}
