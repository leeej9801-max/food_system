import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, type BadgeVariant } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { NumberInput } from "@astryxdesign/core/NumberInput";
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
import { HeroKpi } from "../components/HeroKpi";
import { RecipeEditorModal } from "../components/RecipeEditorModal";
import { useUrlState } from "../lib/useUrlState";
import type {
  Ingredient,
  IngredientRankItem,
  IngredientStockStatus,
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

  const listQuery = useQuery({
    queryKey: ["ingredients", store.id, "all"],
    queryFn: () => fetchIngredients(store.id, { status: "all" }),
  });
  const insightsQuery = useQuery({
    queryKey: ["ingredients", store.id, "insights"],
    queryFn: () => fetchIngredientInsights(store.id),
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

  const keyword = q.trim().toLowerCase();
  const rows: Row[] = (listQuery.data ?? [])
    .filter((i) => filter === "all" || i.stock_status === filter)
    .filter((i) => !keyword || i.name.toLowerCase().includes(keyword))
    .map((i, idx) => ({ ...i, no: idx + 1 }));

  const dim = (r: Row) => (r.stock_status === "INACTIVE" ? "secondary" : "primary");

  const columns: TableColumn<Row>[] = [
    { key: "no", header: "no", width: pixel(56) },
    {
      key: "name",
      header: "식자재명",
      width: proportional(2, { minWidth: 140 }),
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
      width: pixel(110),
      align: "center",
      renderCell: (r) => <Text color={dim(r)}>{r.linked_menu_count}</Text>,
    },
    {
      key: "stock_status",
      header: "상태",
      width: pixel(100),
      renderCell: (r) => <Badge {...STATUS[r.stock_status]} />,
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
    {
      key: "is_active",
      header: "활성화",
      width: pixel(80),
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
  ];

  const insights = insightsQuery.data;
  const all = listQuery.data ?? [];
  const restock = all.filter((i) => i.stock_status === "NEEDS_RESTOCK");
  const inUseCount = all.filter((i) => i.stock_status === "IN_USE").length;
  const unregMenus = insights?.menus_without_recipe ?? [];

  return (
    <div>
      <div className="page-heading">
        <div className="page-title">
          <h1>식자재 관리</h1>
          <span className="title-divider" />
          <span className="title-meta">{all.length}개</span>
        </div>
        <div className="page-actions">
          <button type="button" className="pill pill-primary" onClick={() => setForm(EMPTY_FORM)}>
            + 식자재 추가
          </button>
        </div>
      </div>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-5">
        <section className="card flex min-w-0 flex-col gap-4" aria-label="식자재 목록">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                <Button variant="primary" label="식자재 추가" onClick={() => setForm(EMPTY_FORM)} />
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table<Row> data={rows} columns={columns} idKey="id" hasHover />
            </div>
          )}

          {all.length > 0 && (
            <footer className="flex flex-wrap justify-between gap-2 border-t border-rule pt-4 text-xs text-muted tabular-nums">
              <span>
                전체 식자재 <strong className="font-semibold text-ink">{all.length}</strong>개
              </span>
              <span>
                사용중 {inUseCount} · 입고필요 {restock.length}
              </span>
            </footer>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <HeroKpi
            label="입고 필요"
            value={restock.length}
            unit="종"
            tone={restock.length > 0 ? "alert" : "normal"}
          >
            {restock.length > 0
              ? restock.slice(0, 3).map((i) => i.name).join(", ") +
                (restock.length > 3 ? ` 외 ${restock.length - 3}종` : "")
              : `활성 ${all.filter((i) => i.is_active).length}종 모두 충분`}
          </HeroKpi>

          <div className="card flex flex-col gap-6">
            <RankBlock title="최근 7일 사용량" items={insights?.recent_usage} showBar />
            <RankBlock title="연결 메뉴 많은 순" items={insights?.linked_menus} />
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
              <div className="flex flex-wrap gap-1.5">
                {unregMenus.slice(0, 6).map((m) => (
                  <button
                    key={m.menu_id}
                    type="button"
                    className="pill pill-sm pill-dark"
                    onClick={() => setRecipeTarget({ id: m.menu_id, name: m.name })}
                  >
                    {m.name}
                  </button>
                ))}
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
