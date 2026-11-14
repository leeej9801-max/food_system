import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, type BadgeVariant } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Pagination } from "@astryxdesign/core/Pagination";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Theme } from "@astryxdesign/core/theme";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { defaultThemeSlug, themes } from "../astryx-themes";
import {
  createIngredient,
  fetchIngredientInsights,
  fetchIngredients,
  updateIngredient,
} from "../api/ingredients";
import { fetchInventorySummary } from "../api/inventory";
import { fetchMenus } from "../api/menus";
import { RecipeEditorModal } from "../components/RecipeEditorModal";
import { getMenuCategoryToneClass } from "../lib/menuCategoryColor";
import { useUrlState } from "../lib/useUrlState";
import type {
  Ingredient,
  IngredientInventoryItem,
  IngredientRankItem,
  IngredientStockStatus,
  MenuItem,
  PurchaseUnitType,
  Store,
} from "../types";

type Filter = "all" | "IN_USE" | "IDLE" | "NEEDS_RESTOCK";
const FILTERS: readonly Filter[] = ["all", "IN_USE", "IDLE", "NEEDS_RESTOCK"];

const STATUS: Record<IngredientStockStatus, { label: string; variant: BadgeVariant }> = {
  IN_USE: { label: "사용중", variant: "info" },
  IDLE: { label: "대기", variant: "neutral" },
  NEEDS_RESTOCK: { label: "입고필요", variant: "warning" },
  INACTIVE: { label: "비활성", variant: "neutral" },
};

const UNITS: PurchaseUnitType[] = ["kg", "g", "L", "ml", "ea"];
const unitLabel = (u: string) => (u === "ea" ? "개" : u);
const fmt = (v: string | number) => Number(v).toLocaleString("ko-KR");

type Row = Ingredient & { no: number } & Record<string, unknown>;

const PAGE_SIZE = 20;

export function getIngredientPage(ingredients: Ingredient[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(ingredients.length / PAGE_SIZE));
  const page = Math.max(
    1,
    Math.min(pageCount, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1),
  );
  const offset = (page - 1) * PAGE_SIZE;
  const rows: Row[] = ingredients.slice(offset, offset + PAGE_SIZE).map((ing, index) => ({
    ...ing,
    no: offset + index + 1,
  }));
  return { page, pageCount, offset, rows };
}

export interface RestockUrgentItem {
  ingredient_id: string;
  name: string;
  unit: string;
  safety_stock: number;
  estimated_quantity: number;
  shortage_amount: number;
  shortage_ratio: number;
}

export function getTopRestockIngredients(
  ingredients: Ingredient[],
  inventorySummary: IngredientInventoryItem[] = [],
  recentUsage: IngredientRankItem[] = [],
): RestockUrgentItem[] {
  const summaryById = new Map(inventorySummary.map((item) => [item.ingredient_id, item]));
  const usageById = new Map(recentUsage.map((item) => [item.ingredient_id, Number(item.value)]));
  const candidates = ingredients.filter((item) => item.stock_status === "NEEDS_RESTOCK");

  // 정렬 기준: 안전재고 대비 부족 비율((안전재고 - 추정재고) / 안전재고) 내림차순, 동률이면 부족량·안전재고·7일 사용량·연결 메뉴 수 내림차순
  return candidates
    .map((item) => {
      const inv = summaryById.get(item.id);
      const safety = Math.max(0, Number(item.safety_stock ?? inv?.safety_stock ?? 0));
      const estimated = inv !== undefined ? Number(inv.estimated_quantity) : 0;
      const shortageAmount = safety - estimated;
      const shortageRatio = safety > 0 ? shortageAmount / safety : shortageAmount > 0 ? 1 : 0;
      const usage = usageById.get(item.id) ?? 0;
      return {
        ingredient_id: item.id,
        name: item.name,
        unit: item.base_unit,
        safety_stock: safety,
        estimated_quantity: estimated,
        shortage_amount: shortageAmount,
        shortage_ratio: shortageRatio,
        usage,
        linked_menu_count: item.linked_menu_count,
      };
    })
    .sort((a, b) => {
      if (b.shortage_ratio !== a.shortage_ratio) return b.shortage_ratio - a.shortage_ratio;
      if (b.shortage_amount !== a.shortage_amount) return b.shortage_amount - a.shortage_amount;
      if (b.safety_stock !== a.safety_stock) return b.safety_stock - a.safety_stock;
      if (b.usage !== a.usage) return b.usage - a.usage;
      if (b.linked_menu_count !== a.linked_menu_count) {
        return b.linked_menu_count - a.linked_menu_count;
      }
      return a.name.localeCompare(b.name, "ko-KR");
    })
    .slice(0, 3)
    .map((it) => ({
      ingredient_id: it.ingredient_id,
      name: it.name,
      unit: it.unit,
      safety_stock: it.safety_stock,
      estimated_quantity: it.estimated_quantity,
      shortage_amount: it.shortage_amount,
      shortage_ratio: it.shortage_ratio,
    }));
}

type Props = { store: Store };

export function IngredientManagementPage(props: Props) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <IngredientManagement {...props} />
    </Theme>
  );
}

type FormState = {
  id: string | null;
  name: string;
  safety: number | null;
  unit: PurchaseUnitType;
  notes: string;
};

const EMPTY_FORM: FormState = { id: null, name: "", safety: null, unit: "g", notes: "" };

function IngredientManagement({ store }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useUrlState<Filter>("status", "all", FILTERS);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [recipeTarget, setRecipeTarget] = useState<{ id: string; name: string } | null>(null);
  const keyword = q.trim().toLowerCase();
  const filterKey = JSON.stringify([store.id, filter, keyword]);
  const [pagination, setPagination] = useState({ filterKey, page: 1 });

  const listQuery = useQuery({
    queryKey: ["ingredients", store.id, "all"],
    queryFn: () => fetchIngredients(store.id, { status: "all" }),
  });
  const insightsQuery = useQuery({
    queryKey: ["ingredients", store.id, "insights"],
    queryFn: () => fetchIngredientInsights(store.id),
  });
  const inventorySummaryQuery = useQuery({
    queryKey: ["inventory-summary", store.id, "active"],
    queryFn: () => fetchInventorySummary(store.id, false),
  });
  const menusQuery = useQuery({
    queryKey: ["menus", store.id, "all-for-category"],
    queryFn: () => fetchMenus(store.id, { status: "all" }),
  });

  const refresh = () => {
    for (const key of ["ingredients", "inventory-summary", "menus"]) {
      void queryClient.invalidateQueries({ queryKey: [key, store.id] });
    }
  };
  const fail = (err: unknown, fallback: string) =>
    toast({ body: err instanceof Error && err.message ? err.message : fallback, type: "error" });

  const saveMutation = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        name: f.name.trim(),
        unit: f.unit,
        safety_stock: f.safety,
        notes: f.notes.trim() || null,
      };
      return f.id
        ? updateIngredient(store.id, f.id, body)
        : createIngredient(store.id, { ...body, is_active: true });
    },
    onSuccess: (_, f) => {
      toast({ body: f.id ? "수정했습니다" : "추가했습니다", type: "info" });
      setForm(null);
      refresh();
    },
    onError: (err) => fail(err, "저장하지 못했습니다"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      updateIngredient(store.id, id, { is_active: on }),
    onSuccess: refresh,
    onError: (err) => fail(err, "변경하지 못했습니다"),
  });

  const all = listQuery.data ?? [];
  const filteredIngredients = all
    .filter((i) => filter === "all" || i.stock_status === filter)
    .filter((i) => !keyword || i.name.toLowerCase().includes(keyword));
  const { page, pageCount, offset, rows } = getIngredientPage(
    filteredIngredients,
    pagination.filterKey === filterKey ? pagination.page : 1,
  );
  if (pagination.filterKey !== filterKey || pagination.page !== page) {
    setPagination({ filterKey, page });
  }

  const dim = (r: Row) => (r.stock_status === "INACTIVE" ? "secondary" : "primary");

  const columns: TableColumn<Row>[] = [
    { key: "no", header: "no", width: pixel(48), align: "start" },
    {
      key: "name",
      header: "식자재명",
      width: proportional(1.4, { minWidth: 140 }),
      align: "start",
      renderCell: (r) => <Text color={dim(r)}>{r.name}</Text>,
    },
    {
      key: "safety_stock",
      header: "안전재고",
      width: proportional(1, { minWidth: 100 }),
      align: "end",
      renderCell: (r) => (
        <Text color={dim(r)}>
          {r.safety_stock === null ? "-" : `${fmt(r.safety_stock)} ${unitLabel(r.base_unit)}`}
        </Text>
      ),
    },
    {
      key: "linked_menu_count",
      header: "연결 메뉴 수",
      width: proportional(0.9, { minWidth: 96 }),
      align: "center",
      renderCell: (r) => <Text color={dim(r)}>{r.linked_menu_count}</Text>,
    },
    {
      key: "stock_status",
      header: "상태",
      width: proportional(0.9, { minWidth: 96 }),
      align: "center",
      renderCell: (r) => <Badge {...STATUS[r.stock_status]} />,
    },
    {
      key: "is_active",
      header: "활성화",
      width: proportional(0.8, { minWidth: 84 }),
      align: "center",
      renderCell: (r) => (
        <Switch
          size="sm"
          label={`${r.name} 활성화`}
          isLabelHidden
          value={r.is_active}
          isDisabled={toggleMutation.isPending}
          onChange={(on) => toggleMutation.mutate({ id: r.id, on })}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      width: pixel(56),
      align: "end",
      renderCell: (r) => (
        <MoreMenu
          label={`${r.name} 메뉴`}
          alignment="end"
          items={[
            {
              label: "수정",
              onClick: () =>
                setForm({
                  id: r.id,
                  name: r.name,
                  safety: r.safety_stock === null ? null : Number(r.safety_stock),
                  unit: r.base_unit,
                  notes: r.notes ?? "",
                }),
            },
          ]}
        />
      ),
    },
  ];

  const insights = insightsQuery.data;
  const restock = all.filter((i) => i.stock_status === "NEEDS_RESTOCK");
  const topRestock = getTopRestockIngredients(
    all,
    inventorySummaryQuery.data ?? [],
    insights?.recent_usage ?? [],
  );
  const inUseCount = all.filter((i) => i.stock_status === "IN_USE").length;
  const unregMenus = insights?.menus_without_recipe ?? [];
  const menuCategoryById = new Map<string, string | null>(
    (menusQuery.data ?? []).map((m: MenuItem) => [m.id, m.category]),
  );

  const selectRestockTab = () => setFilter("NEEDS_RESTOCK");

  return (
    <div className="ingredient-management">
      <div className="page-heading shrink-0">
        <div className="page-title">
          <h1>식자재 관리</h1>
          <span className="title-divider" />
          <span className="title-meta">{all.length}개</span>
        </div>
      </div>

      <div className="ingredient-layout grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-5">
        <section className="card menu-list flex min-w-0 flex-col gap-4" aria-label="식자재 목록">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <SegmentedControl
                label="상태"
                value={filter}
                onChange={(v) => setFilter(v as Filter)}
              >
                <SegmentedControlItem value="all" label="전체" />
                <SegmentedControlItem value="IN_USE" label="사용중" />
                <SegmentedControlItem value="IDLE" label="대기" />
                <SegmentedControlItem value="NEEDS_RESTOCK" label="입고필요" />
              </SegmentedControl>
              <div className="w-full sm:w-56">
                <TextInput
                  type="search"
                  label="식자재 검색"
                  isLabelHidden
                  placeholder="식자재 검색"
                  value={q}
                  onChange={setQ}
                  size="sm"
                />
              </div>
            </div>
            <div className="page-actions">
              <button
                type="button"
                className="pill pill-primary"
                onClick={() => setForm(EMPTY_FORM)}
              >
                + 식자재 추가
              </button>
            </div>
          </div>

          <div className="menu-table-region">
            {listQuery.isLoading ? (
              <Text color="secondary">불러오는 중...</Text>
            ) : listQuery.isError ? (
              <EmptyState
                title="불러오지 못했습니다"
                actions={<Button label="다시 시도" onClick={() => void listQuery.refetch()} />}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title="식자재가 없습니다"
                actions={
                  <Button
                    variant="primary"
                    label="식자재 추가"
                    onClick={() => setForm(EMPTY_FORM)}
                  />
                }
              />
            ) : (
              <Table<Row>
                key={`${filterKey}:${page}`}
                data={rows}
                columns={columns}
                idKey="id"
                rowIndexStart={offset + 1}
                rowCount={filteredIngredients.length}
                hasHover
              />
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule pt-3 text-xs text-muted tabular-nums">
            <div className="flex flex-wrap gap-x-4 gap-y-1" aria-live="polite" role="status">
              <span>
                {filteredIngredients.length > 0
                  ? `${offset + 1}–${offset + rows.length}`
                  : "0"}{" "}
                / {filteredIngredients.length}개 · 페이지당 {PAGE_SIZE}개
              </span>
              <span>
                전체 식자재 {all.length}개 · 사용중 {inUseCount} · 입고필요 {restock.length}
              </span>
            </div>
            <Pagination
              label="식자재 목록 페이지"
              page={page}
              totalPages={pageCount}
              size="sm"
              variant="compact"
              isDisabled={
                listQuery.isLoading || listQuery.isError || filteredIngredients.length === 0
              }
              onChange={(next) => setPagination({ filterKey, page: next })}
            />
          </footer>
        </section>

        <div className="ingredient-side flex min-w-0 flex-col gap-4">
          <RestockHeroCard
            totalCount={restock.length}
            activeCount={all.filter((i) => i.is_active).length}
            topItems={topRestock}
            onSelect={selectRestockTab}
          />

          <div className="card flex flex-col gap-6">
            <RankBlock title="최근 7일 식자재 사용량 순" items={insights?.recent_usage} showBar />
            <RankBlock title="연결된 메뉴 많은 식자재 순" items={insights?.linked_menus} />
          </div>

          <section className="flex flex-col gap-3 rounded-2xl bg-accent-50 p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">레시피 미등록 메뉴</h2>
              <span className="text-2xl leading-none font-semibold tracking-tight text-ink tabular-nums">
                {unregMenus.length}
                <small className="ml-0.5 text-xs font-normal text-muted">개</small>
              </span>
            </div>
            {insights && unregMenus.length === 0 ? (
              <p className="text-xs text-muted">모두 등록됨</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {unregMenus.slice(0, 6).map((m) => {
                  const category = menuCategoryById.get(m.menu_id) ?? null;
                  const toneClass = getMenuCategoryToneClass(category);
                  return (
                    <button
                      key={m.menu_id}
                      type="button"
                      title={m.name}
                      className={`pill pill-sm w-full min-w-0 justify-center !px-2.5 ${toneClass}`}
                      onClick={() => setRecipeTarget({ id: m.menu_id, name: m.name })}
                    >
                      <span className="truncate">{m.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog
        isOpen={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        purpose="form"
        width={420}
      >
        {form && (
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim()) return fail(null, "이름을 입력하세요");
              saveMutation.mutate(form);
            }}
          >
            <Heading level={2}>{form.id ? "식자재 수정" : "식자재 추가"}</Heading>
            <TextInput
              label="식자재명"
              value={form.name}
              onChange={(name) => setForm({ ...form, name })}
              hasAutoFocus
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <NumberInput
                  label="안전재고"
                  value={form.safety}
                  hasClear
                  onChange={(safety) => setForm({ ...form, safety })}
                />
              </div>
              <Selector
                label="단위"
                isLabelHidden
                width={88}
                options={UNITS.map((u) => ({ value: u, label: unitLabel(u) }))}
                value={form.unit}
                onChange={(unit) => setForm({ ...form, unit: unit as PurchaseUnitType })}
              />
            </div>
            <TextInput
              label="메모"
              value={form.notes}
              onChange={(notes) => setForm({ ...form, notes })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" label="취소" onClick={() => setForm(null)} />
              <Button
                variant="primary"
                type="submit"
                label="저장"
                isLoading={saveMutation.isPending}
              />
            </div>
          </form>
        )}
      </Dialog>

      <RecipeEditorModal
        open={recipeTarget !== null}
        storeId={store.id}
        menuId={recipeTarget?.id ?? null}
        menuName={recipeTarget?.name ?? ""}
        onClose={() => setRecipeTarget(null)}
        onSaved={refresh}
      />
    </div>
  );
}

export function RestockHeroCard({
  totalCount,
  activeCount,
  topItems,
  onSelect,
}: {
  totalCount: number;
  activeCount: number;
  topItems: RestockUrgentItem[];
  onSelect: () => void;
}) {
  return (
    <section
      role="button"
      tabIndex={0}
      aria-label={`입고 필요 ${totalCount}종 보기`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="card restock-hero-card flex cursor-pointer flex-col justify-between gap-3 text-left !bg-accent-600 text-white"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="kpi-label flex items-center gap-2 !text-white/80">
          {totalCount > 0 && (
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-300" />
          )}
          입고 필요
        </div>
        <div className="text-xl leading-none font-semibold tracking-tight !text-white tabular-nums">
          {totalCount}
          <small className="ml-0.5 text-xs font-normal !text-white/90">종</small>
        </div>
      </div>

      {topItems.length === 0 ? (
        <p className="text-xs text-white/80">활성 {activeCount}종 모두 충분</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {topItems.map((it, idx) => (
            <li
              key={it.ingredient_id}
              className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5"
            >
              <span className="text-xs text-white/75 tabular-nums">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="truncate text-xs font-medium text-white" title={it.name}>
                {it.name}
              </span>
              <span className="text-xs font-semibold text-white tabular-nums">
                {it.shortage_amount > 0 ? `-${fmt(it.shortage_amount)}` : fmt(it.safety_stock)}
                <small className="ml-0.5 text-[11px] font-normal text-white/80">
                  {unitLabel(it.unit)}
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RankBlock({
  title,
  items,
  showBar = false,
}: {
  title: string;
  items?: IngredientRankItem[];
  showBar?: boolean;
}) {
  const maxVal = Math.max(1, ...(items ?? []).map((it) => Number(it.value)));
  return (
    <section className="min-w-0">
      <div className="card-head !mb-3">
        <h2>{title}</h2>
      </div>
      {items && items.length === 0 ? (
        <p className="text-xs text-muted">기록 없음</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items?.map((it, idx) => (
            <li
              key={it.ingredient_id}
              className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1"
            >
              <span className="text-xs text-muted tabular-nums">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="truncate text-xs font-medium text-ink">{it.name}</span>
              <span className="text-sm font-semibold text-ink tabular-nums">
                {fmt(it.value)}
                <small className="ml-0.5 text-[11px] font-normal text-muted">
                  {unitLabel(it.unit)}
                </small>
              </span>
              {showBar && (
                <span className="col-start-2 h-[5px] overflow-hidden rounded-full bg-ground">
                  <span
                    className="block h-full rounded-full bg-accent-300"
                    style={{ width: `${Math.round((Number(it.value) / maxVal) * 100)}%` }}
                  />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
