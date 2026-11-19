import { useQuery } from "@tanstack/react-query";
import { fetchGuestAnalytics } from "../api/analytics";
import { Skeleton, SkeletonTable } from "./Skeleton";
import type { CountBucket, GuestMenuBucket, WeatherGroupItem } from "../types";

// 손님 객층·날씨 분석 (WO-20261116-002). 코드값 → 화면 이름은 홈 입력 화면과 같게 둔다
const LABELS: Record<string, string> = {
  "10S": "10대",
  "20S": "20대",
  "30S": "30대",
  "40S": "40대",
  "50S": "50대",
  "60S_PLUS": "60+",
  MIXED: "혼합",
  FEMALE: "여",
  MALE: "남",
  ALONE: "혼자",
  COUPLE: "연인",
  FRIENDS: "친구",
  FAMILY: "가족",
  COWORKERS: "동료",
  OTHER: "기타",
  MEAL: "식사",
  DATE: "데이트",
  GATHERING: "모임",
  COMPANY: "회식",
};
const WEATHER_LABELS: Record<WeatherGroupItem["key"], string> = {
  RAIN: "비 온 날",
  DRY: "맑은 날",
  COLD: "5도 미만",
  COOL: "5~15도",
  MILD: "15~25도",
  HOT: "25도 이상",
};

const label = (key: string) => LABELS[key] ?? key;
const won = (v: string | number) =>
  Math.round(Number(v)).toLocaleString("ko-KR");

function Bars({
  items,
  unit,
  nameOf = label,
}: {
  items: CountBucket[];
  unit: string;
  nameOf?: (k: string) => string;
}) {
  if (items.length === 0)
    return <p className="py-6 text-center text-sm text-muted">기록 없음</p>;
  const max = Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((sum, i) => sum + i.count, 0);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li
          key={i.key}
          className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3"
        >
          <span className="truncate text-[13px] text-ink">{nameOf(i.key)}</span>
          <span className="h-[6px] overflow-hidden rounded-full bg-ground">
            <span
              className="analytics-bar-h block h-full rounded-full bg-accent-300"
              style={{ width: `${Math.round((i.count / max) * 100)}%` }}
            />
          </span>
          <span className="text-[13px] font-semibold text-ink tabular-nums">
            {i.count}
            <small className="ml-0.5 text-[11px] font-normal text-muted">
              {unit} · {Math.round((i.count / total) * 100)}%
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function MenuTable({ rows }: { rows: GuestMenuBucket[] }) {
  if (rows.length === 0)
    return (
      <p className="py-6 text-center text-sm text-muted">연결된 주문 없음</p>
    );
  return (
    <ul className="flex flex-col divide-y divide-rule">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 py-2.5"
        >
          <span className="text-[13px] font-[550] text-ink">
            {label(r.key)}
            <small className="block text-[11px] font-normal text-muted">
              {r.visit_count}팀
            </small>
          </span>
          <span className="min-w-0 truncate text-[13px] text-ink">
            {r.top_menus
              .map((m) => `${m.menu_name} ${m.quantity}`)
              .join(" · ") || "-"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GuestInsightsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="손님·날씨 분석 불러오는 중">
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-12 xl:mb-5 xl:gap-5">
        {["손님 연령대", "동반 관계", "팀 인원"].map((title) => (
          <section key={title} className="card md:col-span-4">
            <div className="card-head">
              <h2>{title}</h2>
              <Skeleton width={68} height={13} variant="text" />
            </div>
            <div className="flex flex-col gap-3">
              {[80, 62, 48, 34].map((pct, idx) => (
                <div key={idx} className="grid grid-cols-[56px_minmax(0,1fr)_52px] items-center gap-3">
                  <Skeleton width={40} height={13} variant="text" />
                  <Skeleton width={`${pct}%`} height={6} variant="pill" />
                  <Skeleton width={44} height={13} variant="text" className="sk-align-right" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:mb-5 xl:gap-5">
        {["관계별 많이 팔린 메뉴", "연령대별 많이 팔린 메뉴"].map((title) => (
          <section key={title} className="card">
            <div className="card-head">
              <h2>{title}</h2>
              <Skeleton width={44} height={20} variant="pill" />
            </div>
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 py-1">
                  <Skeleton width={44} height={14} variant="text" />
                  <Skeleton width="76%" height={14} variant="text" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="card mb-4 xl:mb-5">
        <div className="card-head">
          <h2>날씨별 매출</h2>
          <Skeleton width={64} height={13} variant="text" />
        </div>
        <SkeletonTable
          tableClassName="w-full min-w-[560px] text-[13px]"
          ariaLabel="날씨별 매출 불러오는 중"
          rows={4}
          columns={[
            { label: "날씨" },
            { label: "일수", align: "right" },
            { label: "일 평균 매출", align: "right" },
            { label: "일 평균 손님", align: "right" },
            { label: "많이 팔린 메뉴" },
            { label: "많은 손님" },
          ]}
        />
      </section>
    </div>
  );
}

export function GuestInsights({ storeId }: { storeId: string }) {
  const query = useQuery({
    queryKey: ["analytics-guests", storeId],
    queryFn: () => fetchGuestAnalytics(storeId),
  });
  if (query.isLoading) return <GuestInsightsSkeleton />;
  const g = query.data;
  if (!g) return null;
  const linkedTotal =
    g.matched_order_count + g.ambiguous_order_count + g.unmatched_order_count;

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-12 xl:mb-5 xl:gap-5">
        <section className="card md:col-span-4">
          <div className="card-head">
            <h2>손님 연령대</h2>
            <span className="card-meta">
              {g.guest_count}명 · 입력 {g.profiled_person_count}명
            </span>
          </div>
          <Bars items={g.age_bands} unit="명" />
        </section>
        <section className="card md:col-span-4">
          <div className="card-head">
            <h2>동반 관계</h2>
            <span className="card-meta">{g.visit_count}팀</span>
          </div>
          <Bars items={g.relationships} unit="팀" />
        </section>
        <section className="card md:col-span-4">
          <div className="card-head">
            <h2>팀 인원</h2>
            {g.avg_stay_minutes !== null && (
              <span className="card-meta">
                평균 체류 {g.avg_stay_minutes}분
              </span>
            )}
          </div>
          <Bars items={g.party_sizes} unit="팀" nameOf={(k) => `${k}명`} />
          {g.genders.length > 0 && (
            <div className="mt-4 border-t border-rule pt-3">
              <Bars items={g.genders} unit="명" />
            </div>
          )}
        </section>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:mb-5 xl:gap-5">
        <section className="card">
          <div className="card-head">
            <h2>관계별 많이 팔린 메뉴</h2>
            <span
              className="chip chip-warn"
              title="주문 시각이 착석 시간과 겹치는 테이블이 하나일 때만 연결"
            >
              추정
            </span>
          </div>
          <MenuTable rows={g.menu_by_relationship} />
          <p className="mt-3 text-xs text-muted">
            주문 {linkedTotal}건 중 연결 {g.matched_order_count} · 겹침{" "}
            {g.ambiguous_order_count} · 미연결 {g.unmatched_order_count}
          </p>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>연령대별 많이 팔린 메뉴</h2>
            <span className="chip chip-warn">추정</span>
          </div>
          <MenuTable rows={g.menu_by_age_band} />
        </section>
      </div>

      <section className="card mb-4 xl:mb-5">
        <div className="card-head">
          <h2>날씨별 매출</h2>
          <span className="card-meta">영업일 {g.weather_days.length}일</span>
        </div>
        {!g.weather_station_configured ? (
          <p className="py-8 text-center text-sm text-muted">
            기상 관측소 미설정
          </p>
        ) : g.weather_groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">날씨 기록 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left text-xs text-muted">
                  <th className="px-2.5 py-2 font-normal">날씨</th>
                  <th className="px-2.5 py-2 text-right font-normal">일수</th>
                  <th className="px-2.5 py-2 text-right font-normal">일 평균 매출</th>
                  <th className="px-2.5 py-2 text-right font-normal">일 평균 손님</th>
                  <th className="px-2.5 py-2 font-normal">많이 팔린 메뉴</th>
                  <th className="px-2.5 py-2 font-normal">많은 손님</th>
                </tr>
              </thead>
              <tbody>
                {g.weather_groups.map((w) => (
                  <tr
                    key={w.key}
                    className="border-b border-rule last:border-0"
                  >
                    <td className="px-2.5 py-2.5 font-[550] text-ink">
                      {WEATHER_LABELS[w.key]}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {w.day_count}
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {won(w.avg_net_sales)}원
                    </td>
                    <td className="px-2.5 py-2.5 text-right tabular-nums">
                      {Number(w.avg_guest_count)}명
                    </td>
                    <td className="max-w-[220px] truncate px-2.5 py-2.5">
                      {w.top_menus.map((m) => m.menu_name).join(" · ") || "-"}
                    </td>
                    <td className="px-2.5 py-2.5">
                      {w.top_relationships
                        .map((r) => label(r.key))
                        .join(" · ") || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
