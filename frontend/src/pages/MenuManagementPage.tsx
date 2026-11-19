import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Pagination } from "@astryxdesign/core/Pagination";
import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import koKR from "@astryxdesign/core/locales/ko-KR.generated.js";
import { Switch } from "@astryxdesign/core/Switch";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { useToast } from "@astryxdesign/core/Toast";
import { Theme } from "@astryxdesign/core/theme";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { defaultThemeSlug, themes } from "../astryx-themes";
import {
  createMenu,
  deleteMenu,
  fetchMenuCategories,
  fetchMenus,
  updateMenu,
} from "../api/menus";
import { fetchSalesAnalytics, simulateMenuCosts } from "../api/analytics";
import { AppLink as Link } from "../components/AppLink";
import { Dialog } from "../components/Dialog";
import { MenuFormModal } from "../components/MenuFormModal";
import { RecipeEditorModal } from "../components/RecipeEditorModal";
import { Skeleton, SkeletonTable } from "../components/Skeleton";
import {
  computeMenuKpi,
  matchesMenuCheckCondition,
  type MenuCheckCondition,
} from "../lib/menuKpi";
import { formatKrwPrice } from "../lib/menuValidation";
import { useAnimatedNumber } from "../lib/useAnimatedNumber";
import { useUrlState } from "../lib/useUrlState";
import type { MenuItem, Store } from "../types";

interface MenuManagementPageProps {
  store: Store;
}

type Status = "all" | "active" | "inactive" | "needs_check";
const STATUS_VALUES: readonly Status[] = ["all", "active", "inactive", "needs_check"];

type CheckParam = "" | MenuCheckCondition;
const CHECK_VALUES: readonly CheckParam[] = ["", "high_cost", "unregistered_recipe", "no_price"];

const CHECK_LABELS: Record<MenuCheckCondition, string> = {
  high_cost: "원가율 높은 메뉴",
  unregistered_recipe: "레시피 미등록",
  no_price: "가격 미입력",
};

type Row = MenuItem & { no: number } & Record<string, unknown>;

const PAGE_SIZE = 20;

export function getMenuPage(menus: MenuItem[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(menus.length / PAGE_SIZE));
  const page = Math.max(
    1,
    Math.min(pageCount, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1),
  );
  const offset = (page - 1) * PAGE_SIZE;
  const rows: Row[] = menus.slice(offset, offset + PAGE_SIZE).map((menu, index) => ({
    ...menu,
    no: offset + index + 1,
  }));
  return { page, pageCount, offset, rows };
}

function MenuOperatingSwitch({
  menu,
  onSave,
}: {
  menu: MenuItem;
  onSave: (active: boolean) => Promise<void>;
}) {
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const active = pendingValue ?? menu.is_active;
  const handleToggle = async (checked: boolean) => {
    try {
      setPendingValue(checked);
      await onSave(checked);
    } finally {
      setPendingValue(null);
    }
  };
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${menu.name} 운영 상태`}
        className={`menu-op-toggle${active ? "" : " is-inactive"}`}
        onClick={() => void handleToggle(!active)}
      >
        {active ? "운영중" : "출시대기"}
      </button>
      <span className="menu-op-switch-hidden" aria-hidden="true">
        <Switch
          size="sm"
          label={active ? "운영중" : "출시대기"}
          value={active}
          onChange={setPendingValue}
          changeAction={handleToggle}
        />
      </span>
    </>
  );
}

export function MenuManagementPage(props: MenuManagementPageProps) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <MenuManagement {...props} />
    </Theme>
  );
}

function MenuManagement({ store }: MenuManagementPageProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchInput, setSearchInput] = useUrlState<string>("q", "");
  const [categoryFilter, setCategoryFilter] = useUrlState<string>("category", "");
  const [statusFilter, setStatusFilter] = useUrlState<Status>("status", "all", STATUS_VALUES);
  const [checkFilter, setCheckFilter] = useUrlState<CheckParam>("check", "", CHECK_VALUES);
  const [modalOpen, setModalOpen] = useState(false);
  const [contributionModalOpen, setContributionModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [recipeTarget, setRecipeTarget] = useState<MenuItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MenuItem | null>(null);
  const filterKey = JSON.stringify([
    store.id,
    searchInput,
    categoryFilter,
    statusFilter,
    checkFilter,
  ]);
  const [pagination, setPagination] = useState({ filterKey, page: 1 });

  const apiStatus: "all" | "active" | "inactive" =
    statusFilter === "needs_check" ? "all" : statusFilter;

  const menusQuery = useQuery({
    queryKey: ["menus", store.id, searchInput, categoryFilter, apiStatus],
    queryFn: () =>
      fetchMenus(store.id, { q: searchInput, category: categoryFilter, status: apiStatus }),
  });

  const allMenusQuery = useQuery({
    queryKey: ["menus", store.id, "", "", "all"],
    queryFn: () => fetchMenus(store.id, { status: "all" }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["menu-categories", store.id],
    queryFn: () => fetchMenuCategories(store.id),
  });
  const categories = categoriesQuery.data ?? [];

  const activeQuery = useQuery({
    queryKey: ["menus", store.id, "active-count"],
    queryFn: () => fetchMenus(store.id, { status: "active" }),
  });

  // 원가는 백엔드 결정론 계산(analytics/costing, 변동 0%)을 그대로 쓴다
  const costQuery = useQuery({
    queryKey: ["menu-costs", store.id],
    queryFn: () => simulateMenuCosts(store.id, { global_change_percent: 0 }),
  });

  // 메뉴별 판매량·매출 비중은 기존 판매 분석 API(analytics/sales)의 menu_rankings를 쓴다
  const salesQuery = useQuery({
    queryKey: ["analytics-sales", store.id],
    queryFn: () => fetchSalesAnalytics(store.id),
  });

  const baseMenus = allMenusQuery.data ?? menusQuery.data ?? [];
  const kpi = computeMenuKpi(baseMenus, costQuery.data, salesQuery.data);

  const pageLoading =
    menusQuery.isLoading ||
    allMenusQuery.isLoading ||
    categoriesQuery.isLoading ||
    activeQuery.isLoading ||
    costQuery.isLoading ||
    salesQuery.isLoading;
  const countsLoading = pageLoading;
  const activeCountLoading = pageLoading;
  const contributionLoading = pageLoading;
  const costKpiLoading = pageLoading;
  const checkKpiLoading = pageLoading;
  const tableLoading = pageLoading;

  const totalMenus =
    categories.length > 0 ? categories.reduce((n, c) => n + c.menu_count, 0) : baseMenus.length;
  const activeCount = activeQuery.data?.length ?? baseMenus.filter((m) => m.is_active).length;
  const standbyCount = Math.max(totalMenus - activeCount, 0);

  const animTotalContribution = useAnimatedNumber(
    contributionLoading ? null : kpi.totalContributionManWon,
  );
  const animMinCost = useAnimatedNumber(costKpiLoading ? null : kpi.minCostRatio);
  const animAvgCost = useAnimatedNumber(costKpiLoading ? null : kpi.weightedAvgCostRatio);
  const animMaxCost = useAnimatedNumber(costKpiLoading ? null : kpi.maxCostRatio);
  const animNeedsCheck = useAnimatedNumber(checkKpiLoading ? null : kpi.needsCheckCount);
  const animHighCost = useAnimatedNumber(checkKpiLoading ? null : kpi.highCostCount);
  const animUnregistered = useAnimatedNumber(checkKpiLoading ? null : kpi.unregisteredRecipeCount);
  const animNoPrice = useAnimatedNumber(checkKpiLoading ? null : kpi.noPriceCount);

  function refresh() {
    return Promise.all(
      [
        "menus",
        "menu-categories",
        "menu-costs",
        "integration-status",
        "analytics-sales",
        "inventory-summary",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key, store.id] })),
    );
  }

  const ok = (body: string) => toast({ body, type: "info" });
  const fail = (err: Error, fallback: string) => toast({ body: err.message || fallback, type: "error" });

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createMenu>[1]) => createMenu(store.id, payload),
    onSuccess: (created) => {
      void refresh();
      ok(`'${created.name}' 메뉴를 등록했습니다.`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      menuId,
      payload,
    }: {
      menuId: string;
      payload: Parameters<typeof updateMenu>[2];
    }) => updateMenu(store.id, menuId, payload),
    onSuccess: async (updated) => {
      await refresh();
      ok(`'${updated.name}' ${updated.is_active ? "운영중" : "출시대기"}으로 저장했습니다.`);
    },
    onError: (err: Error) => fail(err, "메뉴 수정에 실패했습니다."),
  });

  const deleteMutation = useMutation({
    mutationFn: (item: MenuItem) => deleteMenu(store.id, item.id),
    onSuccess: (res, item) => {
      void refresh();
      setDeleteTarget(null);
      ok(
        res.result === "DELETED"
          ? `'${item.name}' 메뉴를 삭제했습니다.`
          : `'${item.name}'은(는) 판매 기록이 있어 지우지 않고 출시대기로 바꿨습니다.`,
      );
    },
    onError: (err: Error) => fail(err, "메뉴 삭제에 실패했습니다."),
  });

  function openForm(item: MenuItem | null) {
    setEditingMenu(item);
    setModalOpen(true);
  }

  async function handleModalSubmit(payload: Parameters<typeof createMenu>[1]) {
    if (editingMenu) {
      await updateMutation.mutateAsync({ menuId: editingMenu.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
  }

  function selectStatusTab(next: Status) {
    setStatusFilter(next);
    if (next !== "needs_check" && checkFilter) {
      setCheckFilter("");
    }
  }

  function selectCheckRow(condition: MenuCheckCondition) {
    if (statusFilter === "needs_check" && checkFilter === condition) {
      setCheckFilter("");
      setStatusFilter("all");
      return;
    }
    setStatusFilter("needs_check");
    setCheckFilter(condition);
  }

  const rawMenus = menusQuery.data ?? [];
  const menus =
    statusFilter === "needs_check" || Boolean(checkFilter)
      ? rawMenus.filter((m) => matchesMenuCheckCondition(kpi.byMenuId.get(m.id), checkFilter))
      : rawMenus;

  const { page, pageCount, offset, rows } = getMenuPage(
    menus,
    pagination.filterKey === filterKey ? pagination.page : 1,
  );
  if (pagination.filterKey !== filterKey || pagination.page !== page) {
    setPagination({ filterKey, page });
  }
  const filtered = Boolean(
    categoryFilter || searchInput || statusFilter !== "all" || checkFilter,
  );

  return (
    <div className="menu-management kpi-page">
      <h1 className="kpi-title">
        메뉴 관리{" "}
        <small>
          {countsLoading || activeCountLoading ? (
            <Skeleton width={112} height={14} variant="text" />
          ) : (
            <>
              {totalMenus}개 · 운영 중 {activeCount}
            </>
          )}
        </small>
      </h1>

      <section className="kpi-grid" aria-label="메뉴 핵심 지표">
        {/* 1. 대표 숫자: 공헌이익 (그라데이션은 여기 숫자 하나만) */}
        <article className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-head-title">
              <b>메뉴 공헌이익</b>
              <Tooltip
                content="공헌이익 = (판매가 − 레시피 원가) × 판매 수량 · 기간 전체 기준, 고정비 미포함"
                touchTrigger="tap"
                focusTrigger="always"
                hasHoverIndication={false}
              >
                <button type="button" className="kpi-info" aria-label="메뉴 공헌이익 안내">
                  i
                </button>
              </Tooltip>
            </span>
            <div className="kpi-head-right">
              <span>판매 데이터 전체 기간</span>
              <button
                type="button"
                className="kpi-head-action"
                disabled={contributionLoading || kpi.allContributionItems.length === 0}
                onClick={() => setContributionModalOpen(true)}
              >
                전체 보기 →
              </button>
            </div>
          </div>
          {contributionLoading ? (
            <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="메뉴 공헌이익 불러오는 중">
              <div className="kpi-big">
                <Skeleton width={144} height={36} />
              </div>
              <Skeleton width="100%" height={12} radius={6} />
              <div className="kpi-rows">
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="kpi-row">
                    <Skeleton width={104} height={14} variant="text" />
                    <Skeleton width={76} height={14} variant="text" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="kpi-big kpi-grad">
                {kpi.totalContributionManWon !== null && animTotalContribution !== null ? (
                  <>
                    {Math.round(animTotalContribution).toLocaleString("ko-KR")}
                    <em>만원</em>
                  </>
                ) : (
                  "미산출"
                )}
              </div>
              <div className="kpi-stack" aria-label="메뉴별 공헌이익 비중">
                {kpi.contributionSegments.map((seg) => (
                  <i key={seg.id} style={{ flex: seg.flex, background: seg.colorVar }} />
                ))}
              </div>
              <div className="kpi-rows">
                {kpi.contributionRows.length === 0 ? (
                  <div className="kpi-row">
                    <span className="l">집계 가능한 레시피·판매 메뉴 없음</span>
                    <span className="v kpi-na">미산출</span>
                  </div>
                ) : (
                  kpi.contributionRows.map((row) => (
                    <div key={row.id} className="kpi-row">
                      <span className="l">
                        <i style={{ background: row.colorVar }} />
                        {row.label}
                      </span>
                      <span className="v">
                        {row.amountManWon.toLocaleString("ko-KR")}만원
                        <small>{row.roundedSharePercent}%</small>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </article>

        {/* 2. 원가율: 숫자 3개 + 최저~최고 막대 */}
        <article className="kpi-card">
          <div className="kpi-head">
            <b>원가율</b>
            <span>판매가 대비 레시피 원가</span>
          </div>
          {costKpiLoading ? (
            <div className="flex flex-1 flex-col gap-3" role="status" aria-busy="true" aria-label="원가율 불러오는 중">
              <div className="kpi-trio">
                {[
                  { color: "#14b8a6", label: "최소" },
                  { color: "#2f6bff", label: "평균" },
                  { color: "#c2410c", label: "최대" },
                ].map((item) => (
                  <div key={item.label}>
                    <strong>
                      <Skeleton width={56} height={24} />
                    </strong>
                    <span>
                      <i style={{ background: item.color }} />
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="kpi-range">
                <Skeleton width="100%" height={10} radius={999} />
              </div>
              <div className="kpi-foot">
                <Skeleton width={108} height={13} variant="text" />
                <Link to="/lab">원가 보기 →</Link>
              </div>
            </div>
          ) : (
            <>
              <div className="kpi-trio">
                <div>
                  <strong className="is-min">
                    {kpi.minCostRatio !== null && animMinCost !== null
                      ? `${animMinCost.toFixed(1)}%`
                      : "미산출"}
                  </strong>
                  <span>
                    <i style={{ background: "#14b8a6" }} />
                    최소
                  </span>
                </div>
                <div>
                  <strong className="is-avg">
                    {kpi.weightedAvgCostRatio !== null && animAvgCost !== null
                      ? `${animAvgCost.toFixed(1)}%`
                      : "미산출"}
                  </strong>
                  <span>
                    <i style={{ background: "#2f6bff" }} />
                    평균
                  </span>
                </div>
                <div>
                  <strong className="is-max">
                    {kpi.maxCostRatio !== null && animMaxCost !== null
                      ? `${animMaxCost.toFixed(1)}%`
                      : "미산출"}
                  </strong>
                  <span>
                    <i style={{ background: "#c2410c" }} />
                    최대
                  </span>
                </div>
              </div>
              <div className="kpi-range" aria-label="메뉴별 원가율 위치">
                <div className="track" />
                {kpi.costedMenuCount > 0 && (
                  <>
                    <span
                      className="dot is-min"
                      style={{ left: "0%" }}
                      title={
                        kpi.minCostMenuName && kpi.minCostRatio !== null
                          ? `${kpi.minCostMenuName} ${kpi.minCostRatio.toFixed(1)}%`
                          : undefined
                      }
                    />
                    <span
                      className="dot is-avg"
                      style={{ left: `${kpi.avgCostLeftPercent}%` }}
                      title={
                        kpi.weightedAvgCostRatio !== null
                          ? `판매 가중 평균 ${kpi.weightedAvgCostRatio.toFixed(1)}%`
                          : undefined
                      }
                    />
                    <span
                      className="dot is-max"
                      style={{ left: "100%" }}
                      title={
                        kpi.maxCostMenuName && kpi.maxCostRatio !== null
                          ? `${kpi.maxCostMenuName} ${kpi.maxCostRatio.toFixed(1)}%`
                          : undefined
                      }
                    />
                    {kpi.minCostMenuName && (
                      <span className="ax" style={{ left: "0%", transform: "none" }}>
                        {kpi.minCostMenuName}
                      </span>
                    )}
                    {kpi.maxCostMenuName && (
                      <span
                        className="ax"
                        style={{ left: "100%", transform: "translateX(-100%)", textAlign: "right" }}
                      >
                        {kpi.maxCostMenuName}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="kpi-foot">
                <span>
                  원가 산출 {kpi.costedMenuCount} / {totalMenus}개
                </span>
                <Link to="/lab">원가 보기 →</Link>
              </div>
            </>
          )}
        </article>

        {/* 3. 확인 필요: 값-라벨 행 + 행동 띠 */}
        <article className="kpi-card kpi-check">
          <div className="kpi-head">
            <b>확인 필요</b>
            <span>
              {checkKpiLoading ? (
                <Skeleton width={28} height={14} variant="text" />
              ) : (
                `${Math.round(animNeedsCheck ?? kpi.needsCheckCount)}건`
              )}
            </span>
          </div>
          {checkKpiLoading ? (
            <div className="flex flex-1 flex-col gap-2" role="status" aria-busy="true" aria-label="확인 필요 항목 불러오는 중">
              <div className="kpi-rows">
                {[
                  { color: "var(--kpi-warn)", label: "원가율 높은 메뉴" },
                  { color: "#f5b301", label: "레시피 미등록" },
                  { color: "var(--kpi-c5)", label: "가격 미입력" },
                ].map((item) => (
                  <div key={item.label} className="kpi-row">
                    <span className="l">
                      <i style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <Skeleton width={32} height={14} variant="text" />
                  </div>
                ))}
              </div>
              <div className="kpi-foot">
                <Skeleton width={116} height={13} variant="text" />
              </div>
            </div>
          ) : (
            <>
              <div className="kpi-rows">
                <button
                  type="button"
                  disabled={kpi.highCostCount === 0}
                  aria-pressed={statusFilter === "needs_check" && checkFilter === "high_cost"}
                  className={`kpi-row kpi-row-btn${
                    statusFilter === "needs_check" && checkFilter === "high_cost" ? " is-active" : ""
                  }`}
                  onClick={() => selectCheckRow("high_cost")}
                >
                  <span className="l">
                    <i style={{ background: "var(--kpi-warn)" }} />
                    원가율 높은 메뉴
                  </span>
                  <span className={`v${kpi.highCostCount > 0 ? " w" : ""}`}>
                    {Math.round(animHighCost ?? kpi.highCostCount)}개
                  </span>
                </button>
                <button
                  type="button"
                  disabled={kpi.unregisteredRecipeCount === 0}
                  aria-pressed={
                    statusFilter === "needs_check" && checkFilter === "unregistered_recipe"
                  }
                  className={`kpi-row kpi-row-btn${
                    statusFilter === "needs_check" && checkFilter === "unregistered_recipe"
                      ? " is-active"
                      : ""
                  }`}
                  onClick={() => selectCheckRow("unregistered_recipe")}
                >
                  <span className="l">
                    <i style={{ background: "#f5b301" }} />
                    레시피 미등록
                  </span>
                  <span className={`v${kpi.unregisteredRecipeCount > 0 ? " w" : ""}`}>
                    {Math.round(animUnregistered ?? kpi.unregisteredRecipeCount)}개
                  </span>
                </button>
                <button
                  type="button"
                  disabled={kpi.noPriceCount === 0}
                  aria-pressed={statusFilter === "needs_check" && checkFilter === "no_price"}
                  className={`kpi-row kpi-row-btn${
                    statusFilter === "needs_check" && checkFilter === "no_price" ? " is-active" : ""
                  }`}
                  onClick={() => selectCheckRow("no_price")}
                >
                  <span className="l">
                    <i style={{ background: "var(--kpi-c5)" }} />
                    가격 미입력
                  </span>
                  <span className={`v${kpi.noPriceCount > 0 ? " w" : ""}`}>
                    {Math.round(animNoPrice ?? kpi.noPriceCount)}개
                  </span>
                </button>
              </div>
              <div className="kpi-foot">
                {kpi.firstAction ? (
                  <>
                    <span>{kpi.firstAction.menu.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (kpi.firstAction?.kind === "PRICE") {
                          openForm(kpi.firstAction.menu);
                        } else if (kpi.firstAction) {
                          setRecipeTarget(kpi.firstAction.menu);
                        }
                      }}
                    >
                      {kpi.firstAction.label}
                    </button>
                  </>
                ) : (
                  <span>확인할 항목 없음</span>
                )}
              </div>
            </>
          )}
        </article>
      </section>

      <section className="kpi-table-section" aria-label="메뉴 목록">
        <div className="kpi-bar">
          <div className="kpi-tabs" role="tablist" aria-label="판매 상태">
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === "all"}
              className={statusFilter === "all" ? "on" : undefined}
              onClick={() => selectStatusTab("all")}
            >
              전체<em>{countsLoading ? <Skeleton width={16} height={11} variant="text" /> : totalMenus}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === "active"}
              className={statusFilter === "active" ? "on" : undefined}
              onClick={() => selectStatusTab("active")}
            >
              운영중<em>{activeCountLoading ? <Skeleton width={16} height={11} variant="text" /> : activeCount}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === "inactive"}
              className={statusFilter === "inactive" ? "on" : undefined}
              onClick={() => selectStatusTab("inactive")}
            >
              출시대기
              <em>
                {countsLoading || activeCountLoading ? (
                  <Skeleton width={16} height={11} variant="text" />
                ) : (
                  standbyCount
                )}
              </em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === "needs_check"}
              className={statusFilter === "needs_check" ? "on" : undefined}
              onClick={() => {
                setStatusFilter("needs_check");
                setCheckFilter("");
              }}
            >
              확인 필요
              <em>
                {checkKpiLoading ? (
                  <Skeleton width={16} height={11} variant="text" />
                ) : (
                  kpi.needsCheckCount
                )}
              </em>
            </button>
          </div>
          <div className="kpi-right">
            {checkFilter && (
              <button
                type="button"
                className="chip chip-warn menu-cat-chip-btn"
                aria-label={`${CHECK_LABELS[checkFilter]} 필터 해제`}
                onClick={() => {
                  setCheckFilter("");
                  setStatusFilter("all");
                }}
              >
                {CHECK_LABELS[checkFilter]} ×
              </button>
            )}
            {categoryFilter && (
              <button
                type="button"
                className="chip chip-ok menu-cat-chip-btn"
                aria-label={`${categoryFilter} 필터 해제`}
                onClick={() => setCategoryFilter("")}
              >
                {categoryFilter} ×
              </button>
            )}
            <input
              type="search"
              className="kpi-search"
              aria-label="메뉴 이름 검색"
              placeholder="메뉴 이름 검색"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="button" className="kpi-primary" onClick={() => openForm(null)}>
              + 메뉴 추가
            </button>
          </div>
        </div>

        <div className="menu-table-region">
          {tableLoading ? (
            <SkeletonTable
              tableClassName="kpi-table"
              ariaLabel="메뉴 목록 불러오는 중"
              rows={7}
              columns={[
                { label: "종류", width: "12%" },
                { label: "메뉴 이름", width: "22%" },
                { label: "가격", align: "right", width: "11%" },
                { label: "원가율", align: "right", width: "10%" },
                { label: "마진", align: "right", width: "12%" },
                { label: "판매 비중", align: "right", width: "13%" },
                { label: "레시피", align: "center", width: "10%" },
                { label: "운영", align: "center", width: "10%" },
              ]}
            />
          ) : menusQuery.isError ? (
            <EmptyState
              title="메뉴 목록 조회에 실패했습니다."
              description="잠시 뒤 다시 시도해 주세요."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={filtered ? "조건에 맞는 메뉴가 없습니다." : "아직 등록된 메뉴가 없습니다."}
              actions={
                <Button variant="primary" label="메뉴 추가" onClick={() => openForm(null)} />
              }
            />
          ) : (
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>
                    <select
                      aria-label="유형 필터"
                      className="menu-cat-select"
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="">종류</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name} ({c.menu_count})
                        </option>
                      ))}
                    </select>
                  </th>
                  <th>메뉴 이름</th>
                  <th className="n">가격</th>
                  <th className="n">원가율</th>
                  <th className="n">마진</th>
                  <th className="n">판매 비중</th>
                  <th className="c">레시피</th>
                  <th className="c">운영</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const metrics = kpi.byMenuId.get(m.id);
                  const recipeLabel =
                    m.recipe_status === "COMPLETE"
                      ? "등록완료"
                      : m.recipe_status === "PARTIAL"
                        ? "등록중"
                        : "미등록";
                  const recipeTone =
                    m.recipe_status === "COMPLETE"
                      ? "chip-ok"
                      : m.recipe_status === "PARTIAL"
                        ? "chip-warn"
                        : "chip-warn";

                  return (
                    <tr key={m.id}>
                      <td>
                        {m.category ? (
                          <button
                            type="button"
                            aria-pressed={categoryFilter === m.category}
                            aria-label={`${m.category} 유형 필터${categoryFilter === m.category ? ", 선택됨" : ""}`}
                            onClick={() =>
                              setCategoryFilter(categoryFilter === m.category ? "" : m.category!)
                            }
                            className="chip chip-idle menu-cat-chip-btn"
                          >
                            {m.category}
                          </button>
                        ) : (
                          <span className="kpi-na">-</span>
                        )}
                      </td>
                      <td>{m.name}</td>
                      <td className="n">
                        {m.selling_price !== null ? (
                          formatKrwPrice(m.selling_price)
                        ) : (
                          <span className="kpi-na">미입력</span>
                        )}
                      </td>
                      <td
                        className={`n${
                          costQuery.isLoading
                            ? ""
                            : metrics?.highCostWarning
                              ? " kpi-hi"
                              : metrics?.costRatioPercent === null ||
                                  metrics?.costRatioPercent === undefined
                                ? " kpi-na"
                                : ""
                        }`}
                      >
                        {costQuery.isLoading ? (
                          <Skeleton width={44} height={14} variant="text" className="sk-align-right" />
                        ) : metrics?.costRatioPercent !== null &&
                          metrics?.costRatioPercent !== undefined ? (
                          `${metrics.costRatioPercent.toFixed(1)}%`
                        ) : (
                          "미산출"
                        )}
                      </td>
                      <td
                        className={`n${
                          !costQuery.isLoading &&
                          (metrics?.marginWon === null || metrics?.marginWon === undefined)
                            ? " kpi-na"
                            : ""
                        }`}
                      >
                        {costQuery.isLoading ? (
                          <Skeleton width={56} height={14} variant="text" className="sk-align-right" />
                        ) : metrics?.marginWon !== null && metrics?.marginWon !== undefined ? (
                          `${metrics.marginWon.toLocaleString("ko-KR")}원`
                        ) : (
                          "미산출"
                        )}
                      </td>
                      <td className="n">
                        {salesQuery.isLoading ? (
                          <Skeleton width={54} height={14} variant="text" className="sk-align-right" />
                        ) : metrics?.salesSharePercent !== null &&
                          metrics?.salesSharePercent !== undefined ? (
                          <span className="kpi-share">
                            <i style={{ width: `${metrics.salesShareBarPx}px` }} />
                            {Math.round(metrics.salesSharePercent)}%
                          </span>
                        ) : (
                          <span className="kpi-na">미산출</span>
                        )}
                      </td>
                      <td className="c">
                        <button
                          type="button"
                          className={`chip menu-recipe-chip ${recipeTone}`}
                          aria-label={`${m.name} 레시피 ${recipeLabel} 보기`}
                          onClick={() => setRecipeTarget(m)}
                        >
                          {recipeLabel}
                        </button>
                      </td>
                      <td className="c">
                        <div className="menu-op-cell">
                          <MenuOperatingSwitch
                            menu={m}
                            onSave={async (checked) => {
                              await updateMutation.mutateAsync({
                                menuId: m.id,
                                payload: { is_active: checked },
                              });
                            }}
                          />
                          <MoreMenu
                            label={`${m.name} 메뉴 작업`}
                            alignment="end"
                            items={[
                              { label: "수정", onClick: () => openForm(m) },
                              {
                                label: "삭제",
                                variant: "destructive",
                                onClick: () => setDeleteTarget(m),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="kpi-note">
          숫자는 개발 DB 샘플 매장 실제 값. 공헌이익 = (판매가 − 레시피 원가) × 판매량, 할인·환불 미반영.
        </p>

        {pageCount > 1 ? (
          <footer className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule pt-3 text-xs text-muted tabular-nums">
            <div className="flex flex-wrap gap-x-4 gap-y-1" aria-live="polite" role="status">
              <span>
                {menus.length > 0 ? `${offset + 1}–${offset + rows.length}` : "0"} / {menus.length}개 ·
                페이지당 {PAGE_SIZE}개
              </span>
            </div>
            <InternationalizationProvider locale="ko-KR" messages={{ "ko-KR": koKR }}>
              <Pagination
                label="메뉴 목록 페이지"
                page={page}
                totalPages={pageCount}
                size="sm"
                variant="compact"
                isDisabled={tableLoading || menusQuery.isError || menus.length === 0}
                onChange={(next) => setPagination({ filterKey, page: next })}
              />
            </InternationalizationProvider>
          </footer>
        ) : (
          <div className="sr-only">
            <InternationalizationProvider locale="ko-KR" messages={{ "ko-KR": koKR }}>
              <Pagination
                label="메뉴 목록 페이지"
                page={page}
                totalPages={pageCount}
                size="sm"
                variant="compact"
                isDisabled={tableLoading || menusQuery.isError || menus.length === 0}
                onChange={(next) => setPagination({ filterKey, page: next })}
              />
            </InternationalizationProvider>
          </div>
        )}
      </section>

      {contributionModalOpen && (
        <Dialog label="메뉴 공헌이익 전체 보기" onClose={() => setContributionModalOpen(false)}>
          <div className="kpi-detail-modal">
            <div className="kpi-modal-head">
              <div>
                <h2>메뉴 공헌이익 전체</h2>
                <p className="kpi-modal-sub">
                  판매 데이터 전체 기간 · 합계{" "}
                  {kpi.totalContributionManWon !== null
                    ? `${kpi.totalContributionManWon.toLocaleString("ko-KR")}만원`
                    : "미산출"}
                </p>
              </div>
              <button
                type="button"
                className="pill pill-sm pill-soft"
                onClick={() => setContributionModalOpen(false)}
              >
                닫기
              </button>
            </div>
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>메뉴</th>
                  <th className="n">판매량</th>
                  <th className="n">마진</th>
                  <th className="n">공헌이익</th>
                  <th className="n">비중</th>
                </tr>
              </thead>
              <tbody>
                {kpi.allContributionItems.map((item) => (
                  <tr key={item.menuId}>
                    <td>{item.name}</td>
                    <td className="n">{item.quantity.toLocaleString("ko-KR")}개</td>
                    <td className="n">{item.marginWon.toLocaleString("ko-KR")}원</td>
                    <td className="n">{item.profitManWon.toLocaleString("ko-KR")}만원</td>
                    <td className="n">{item.sharePercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}

      <AlertDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`'${deleteTarget?.name ?? ""}' 메뉴를 삭제할까요?`}
        description="판매 기록이 있으면 지우지 않고 출시대기로만 바뀝니다."
        actionLabel="삭제"
        cancelLabel="취소"
        isActionLoading={deleteMutation.isPending}
        onAction={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
      />

      <MenuFormModal
        open={modalOpen}
        initialMenu={editingMenu}
        categories={categories.map((c) => c.name)}
        onClose={() => setModalOpen(false)}
        onSubmit={handleModalSubmit}
      />

      <RecipeEditorModal
        open={Boolean(recipeTarget)}
        storeId={store.id}
        menuId={recipeTarget?.id ?? null}
        menuName={recipeTarget?.name ?? ""}
        onClose={() => setRecipeTarget(null)}
        onSaved={() => {
          void refresh();
          ok(`'${recipeTarget?.name}' 레시피를 저장했습니다.`);
        }}
      />
    </div>
  );
}

