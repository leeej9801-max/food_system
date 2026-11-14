import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Pagination } from "@astryxdesign/core/Pagination";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
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
  createMenu,
  createMenuCategory,
  deleteMenu,
  fetchMenuCategories,
  fetchMenus,
  updateMenu,
} from "../api/menus";
import { MenuFormModal } from "../components/MenuFormModal";
import { RecipeEditorModal } from "../components/RecipeEditorModal";
import { formatKrwPrice } from "../lib/menuValidation";
import { useUrlState } from "../lib/useUrlState";
import type { MenuItem, Store } from "../types";

interface MenuManagementPageProps {
  store: Store;
}

type Status = "all" | "active" | "inactive";
// astryx Table은 행 타입에 문자열 색인을 요구한다
type Row = MenuItem & { no: number } & Record<string, unknown>;

const PAGE_SIZE = 20;

export function getMenuPage(menus: MenuItem[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(menus.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(pageCount, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1));
  const offset = (page - 1) * PAGE_SIZE;
  const rows: Row[] = menus.slice(offset, offset + PAGE_SIZE).map((menu, index) => ({
    ...menu,
    no: offset + index + 1,
  }));
  return { page, pageCount, offset, rows };
}

function MenuOperatingSwitch({ menu, onSave }: { menu: MenuItem; onSave: (active: boolean) => Promise<void> }) {
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const active = pendingValue ?? menu.is_active;
  return (
    <Switch
      size="sm"
      label={active ? "운영중" : "출시대기"}
      value={active}
      onChange={setPendingValue}
      changeAction={async (checked) => {
        try {
          await onSave(checked);
        } finally {
          setPendingValue(null);
        }
      }}
    />
  );
}

// design/astryx-menu: astryx 시험 화면. 테마와 CSS를 이 화면 묶음 안에만 둔다 (앱은 밝은 화면만 쓴다)
export function MenuManagementPage(props: MenuManagementPageProps) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <MenuManagement {...props} />
    </Theme>
  );
}

// 위쪽 유형 카드로 아래 표를 거른다 (U-49)
function MenuManagement({ store }: MenuManagementPageProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchInput, setSearchInput] = useUrlState<string>("q", "");
  const [categoryFilter, setCategoryFilter] = useUrlState<string>("category", "");
  const [statusFilter, setStatusFilter] = useUrlState<Status>("status", "all", ["all", "active", "inactive"]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [recipeTarget, setRecipeTarget] = useState<MenuItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MenuItem | null>(null);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const filterKey = JSON.stringify([store.id, searchInput, categoryFilter, statusFilter]);
  const [pagination, setPagination] = useState({ filterKey, page: 1 });

  const menusQuery = useQuery({
    queryKey: ["menus", store.id, searchInput, categoryFilter, statusFilter],
    queryFn: () => fetchMenus(store.id, { q: searchInput, category: categoryFilter, status: statusFilter }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["menu-categories", store.id],
    queryFn: () => fetchMenuCategories(store.id),
  });
  const categories = categoriesQuery.data ?? [];
  const totalMenus = categories.reduce((n, c) => n + c.menu_count, 0);
  const activeQuery = useQuery({
    queryKey: ["menus", store.id, "active-count"],
    queryFn: () => fetchMenus(store.id, { status: "active" }),
  });
  const activeCount = activeQuery.data?.length ?? 0;

  function refresh() {
    return Promise.all(
      ["menus", "menu-categories", "integration-status", "analytics-sales", "inventory-summary"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, store.id] }),
      ),
    );
  }

  const ok = (body: string) => toast({ body, type: "info" });
  const fail = (err: Error, fallback: string) => toast({ body: err.message || fallback, type: "error" });

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createMenu>[1]) => createMenu(store.id, payload),
    onSuccess: (created) => {
      refresh();
      ok(`'${created.name}' 메뉴를 등록했습니다.`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ menuId, payload }: { menuId: string; payload: Parameters<typeof updateMenu>[2] }) =>
      updateMenu(store.id, menuId, payload),
    onSuccess: async (updated) => {
      await refresh();
      ok(`'${updated.name}' ${updated.is_active ? "운영중" : "출시대기"}으로 저장했습니다.`);
    },
    onError: (err: Error) => fail(err, "메뉴 수정에 실패했습니다."),
  });

  const deleteMutation = useMutation({
    mutationFn: (item: MenuItem) => deleteMenu(store.id, item.id),
    onSuccess: (res, item) => {
      refresh();
      setDeleteTarget(null);
      ok(
        res.result === "DELETED"
          ? `'${item.name}' 메뉴를 삭제했습니다.`
          : `'${item.name}'은(는) 판매 기록이 있어 지우지 않고 출시대기로 바꿨습니다.`,
      );
    },
    onError: (err: Error) => fail(err, "메뉴 삭제에 실패했습니다."),
  });

  const categoryMutation = useMutation({
    mutationFn: (name: string) => createMenuCategory(store.id, name),
    onSuccess: (created) => {
      refresh();
      setNewCategory(null);
      ok(`'${created.name}' 유형을 추가했습니다.`);
    },
    onError: (err: Error) => fail(err, "유형 추가에 실패했습니다."),
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

  function submitCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = (newCategory ?? "").trim();
    if (name) categoryMutation.mutate(name);
  }

  const columns: TableColumn<Row>[] = [
    { key: "no", header: "no", width: pixel(48), align: "start" },
    {
      key: "category", header: "종류", width: proportional(1, { minWidth: 100 }), align: "start",
      renderCell: (m) => m.category ?? "-",
    },
    {
      key: "name",
      header: "메뉴 이름",
      width: proportional(1.5, { minWidth: 180 }),
      align: "start",
      renderCell: (m) => (
        <Text weight="medium" color={m.is_active ? "primary" : "secondary"}>
          {m.name}
        </Text>
      ),
    },
    {
      key: "selling_price",
      header: "가격",
      width: proportional(1, { minWidth: 110 }),
      align: "start",
      renderCell: (m) => (m.selling_price !== null ? formatKrwPrice(m.selling_price) : <Text color="secondary">미입력</Text>),
    },
    {
      key: "is_active",
      header: "운영",
      width: proportional(1, { minWidth: 140 }),
      align: "start",
      renderCell: (m) => (
        <MenuOperatingSwitch
          menu={m}
          onSave={async (checked) => {
            await updateMutation.mutateAsync({ menuId: m.id, payload: { is_active: checked } });
          }}
        />
      ),
    },
    {
      key: "recipe_status",
      header: "레시피",
      width: proportional(1, { minWidth: 140 }),
      align: "start",
      renderCell: (m) => {
        const status = m.recipe_status === "COMPLETE"
          ? `등록완료 +${m.recipe_item_count}`
          : m.recipe_status === "PARTIAL" ? "등록중" : "미등록";
        const tone = m.recipe_status === "COMPLETE"
          ? "chip-ok" : m.recipe_status === "PARTIAL" ? "chip-warn" : "chip-idle";
        return (
          <button
            type="button"
            className={`chip menu-recipe-chip ${tone}`}
            aria-label={`${m.name} 레시피 ${status} 보기`}
            onClick={() => setRecipeTarget(m)}
          >
            {status}
          </button>
        );
      },
    },
    {
      key: "actions",
      header: "관리",
      width: pixel(64),
      align: "start",
      renderCell: (m) => (
        <MoreMenu
          label={`${m.name} 메뉴 작업`}
          alignment="end"
          items={[
            { label: "수정", onClick: () => openForm(m) },
            { label: "삭제", variant: "destructive", onClick: () => setDeleteTarget(m) },
          ]}
        />
      ),
    },
  ];

  const menus = menusQuery.data ?? [];
  const { page, pageCount, offset, rows } = getMenuPage(menus, pagination.filterKey === filterKey ? pagination.page : 1);
  if (pagination.filterKey !== filterKey || pagination.page !== page) {
    setPagination({ filterKey, page });
  }
  const filtered = Boolean(categoryFilter || searchInput || statusFilter !== "all");
  const allSelected = categoryFilter === "";
  const standbyCount = Math.max(totalMenus - activeCount, 0);

  return (
    <div className="menu-management">
      <div className="page-heading shrink-0">
        <div className="page-title">
          <h1>메뉴 관리</h1>
          <span className="title-divider" />
          <span className="title-meta">{totalMenus}개</span>
        </div>
      </div>

      {/* 메뉴 유형 카드: 누르면 아래 표를 그 유형으로 거른다 */}
      <section
        aria-label="메뉴 유형"
        data-testid="menu-category-cards"
        className="menu-category-bar"
      >
        <button
          type="button"
          aria-pressed={allSelected}
          aria-label={`전체 ${totalMenus}개${allSelected ? ", 선택됨" : ""}`}
          onClick={() => setCategoryFilter("")}
          className="menu-summary"
        >
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-medium">전체</span>
            <strong className="text-2xl font-semibold tabular-nums">
              {totalMenus}<small className="ml-1 text-xs font-normal">개</small>
            </strong>
          </span>
          <span className="text-xs tabular-nums">운영 중 {activeCount} · 출시 대기 {standbyCount}</span>
        </button>

        <div className="menu-category-strip" role="group" aria-label="유형 필터">
          {categories.length === 0 ? (
            <div className="shrink-0 px-3 text-xs text-muted">
              등록된 유형이 없습니다
            </div>
          ) : (
            categories.map((c) => {
              const on = categoryFilter === c.name;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${c.name} ${c.menu_count}개${on ? ", 선택됨" : ""}`}
                  onClick={() => setCategoryFilter(on ? "" : c.name)}
                  className="menu-category-tab"
                >
                  <span>{c.name}</span>
                  <span className="text-xs text-muted tabular-nums">{c.menu_count}</span>
                </button>
              );
            })
          )}
          {newCategory === null ? (
            <button
              type="button"
              aria-label="유형 추가"
              onClick={() => setNewCategory("")}
              className="menu-category-tab menu-category-add"
            >
              + 유형 추가
            </button>
          ) : (
            <form onSubmit={submitCategory} className="flex shrink-0 items-center gap-2">
              <div className="w-40">
                <TextInput
                  label="새 메뉴 유형"
                  isLabelHidden
                  size="sm"
                  hasAutoFocus
                  value={newCategory}
                  placeholder="예: 뇨끼"
                  onChange={(v) => setNewCategory(v.slice(0, 50))}
                  onKeyDown={(e) => e.key === "Escape" && setNewCategory(null)}
                />
              </div>
              <div className="flex gap-1.5">
                <Button type="submit" size="sm" variant="primary" label="추가" isLoading={categoryMutation.isPending} />
                <Button size="sm" variant="ghost" label="취소" onClick={() => setNewCategory(null)} />
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="card menu-list flex flex-col gap-4" aria-label="메뉴 목록">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="w-full sm:w-56">
              <TextInput
                type="search"
                label="메뉴 이름 검색"
                isLabelHidden
                placeholder="메뉴 이름 검색"
                value={searchInput}
                onChange={setSearchInput}
                size="sm"
              />
            </div>
            <SegmentedControl label="판매 상태" value={statusFilter} onChange={(v) => setStatusFilter(v as Status)}>
              <SegmentedControlItem value="all" label="전체" />
              <SegmentedControlItem value="active" label="운영중" />
              <SegmentedControlItem value="inactive" label="출시대기" />
            </SegmentedControl>
          </div>
          <div className="page-actions">
            <button type="button" className="pill pill-primary" onClick={() => openForm(null)}>
              + 메뉴 추가
            </button>
          </div>
        </div>

        <div className="menu-table-region">
          {menusQuery.isLoading ? (
            <Text color="secondary">메뉴 목록을 불러오는 중입니다...</Text>
          ) : menusQuery.isError ? (
            <EmptyState title="메뉴 목록 조회에 실패했습니다." description="잠시 뒤 다시 시도해 주세요." />
          ) : rows.length === 0 ? (
            <EmptyState
              title={filtered ? "조건에 맞는 메뉴가 없습니다." : "아직 등록된 메뉴가 없습니다."}
              actions={<Button variant="primary" label="메뉴 추가" onClick={() => openForm(null)} />}
            />
          ) : (
            <Table<Row>
              key={`${filterKey}:${page}`}
              data={rows}
              columns={columns}
              idKey="id"
              rowIndexStart={offset + 1}
              rowCount={menus.length}
              hasHover
            />
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule pt-3 text-xs text-muted tabular-nums">
          <div className="flex flex-wrap gap-x-4 gap-y-1" aria-live="polite" role="status">
            <span>{menus.length > 0 ? `${offset + 1}–${offset + rows.length}` : "0"} / {menus.length}개 · 페이지당 {PAGE_SIZE}개</span>
            <span>전체 메뉴 {totalMenus}개 · 운영중 {activeCount} · 출시대기 {standbyCount}</span>
          </div>
          <Pagination
            label="메뉴 목록 페이지"
            page={page}
            totalPages={pageCount}
            size="sm"
            variant="compact"
            isDisabled={menusQuery.isLoading || menusQuery.isError || menus.length === 0}
            onChange={(next) => setPagination({ filterKey, page: next })}
          />
        </footer>
      </section>

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
          refresh();
          ok(`'${recipeTarget?.name}' 레시피를 저장했습니다.`);
        }}
      />
    </div>
  );
}
