import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

type Toast = { type: "success" | "error"; text: string };

// 위쪽 유형 카드로 아래 표를 거른다 (U-49)
export function MenuManagementPage({ store }: MenuManagementPageProps) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useUrlState<string>("q", "");
  const [categoryFilter, setCategoryFilter] = useUrlState<string>("category", "");
  const [statusFilter, setStatusFilter] = useUrlState<"all" | "active" | "inactive">(
    "status", "all", ["all", "active", "inactive"],
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [recipeTarget, setRecipeTarget] = useState<MenuItem | null>(null);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const menusQuery = useQuery({
    queryKey: ["menus", store.id, searchInput, categoryFilter, statusFilter],
    queryFn: () =>
      fetchMenus(store.id, { q: searchInput, category: categoryFilter, status: statusFilter }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["menu-categories", store.id],
    queryFn: () => fetchMenuCategories(store.id),
  });
  const categories = categoriesQuery.data ?? [];
  const totalMenus = categories.reduce((n, c) => n + c.menu_count, 0);

  function refresh() {
    for (const key of ["menus", "menu-categories", "integration-status", "analytics-sales", "inventory-summary"]) {
      queryClient.invalidateQueries({ queryKey: [key, store.id] });
    }
  }

  function fail(err: Error, fallback: string) {
    setToast({ type: "error", text: err.message || fallback });
  }

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createMenu>[1]) => createMenu(store.id, payload),
    onSuccess: (created) => {
      refresh();
      setToast({ type: "success", text: `'${created.name}' 메뉴를 등록했습니다.` });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ menuId, payload }: { menuId: string; payload: Parameters<typeof updateMenu>[2] }) =>
      updateMenu(store.id, menuId, payload),
    onSuccess: (updated) => {
      refresh();
      setToast({
        type: "success",
        text: `'${updated.name}' ${updated.is_active ? "운영중" : "출시대기"}으로 저장했습니다.`,
      });
    },
    onError: (err: Error) => fail(err, "메뉴 수정에 실패했습니다."),
  });

  const deleteMutation = useMutation({
    mutationFn: (item: MenuItem) => deleteMenu(store.id, item.id),
    onSuccess: (res, item) => {
      refresh();
      setToast({
        type: "success",
        text:
          res.result === "DELETED"
            ? `'${item.name}' 메뉴를 삭제했습니다.`
            : `'${item.name}'은(는) 판매 기록이 있어 지우지 않고 출시대기로 바꿨습니다.`,
      });
    },
    onError: (err: Error) => fail(err, "메뉴 삭제에 실패했습니다."),
  });

  const categoryMutation = useMutation({
    mutationFn: (name: string) => createMenuCategory(store.id, name),
    onSuccess: (created) => {
      refresh();
      setNewCategory(null);
      setToast({ type: "success", text: `'${created.name}' 유형을 추가했습니다.` });
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

  function handleDelete(item: MenuItem) {
    if (window.confirm(`'${item.name}' 메뉴를 삭제할까요? 판매 기록이 있으면 출시대기로만 바뀝니다.`)) {
      deleteMutation.mutate(item);
    }
  }

  function submitCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = (newCategory ?? "").trim();
    if (name) categoryMutation.mutate(name);
  }

  function renderRecipe(item: MenuItem) {
    if (item.recipe_status === "COMPLETE") {
      return <span className="text-emerald-800">등록완료 +{item.recipe_item_count}</span>;
    }
    if (item.recipe_status === "PARTIAL") {
      return <span className="text-amber-800">등록중</span>;
    }
    return <span className="text-gray-500">미등록</span>;
  }

  const cardBase = "rounded-lg border px-4 py-3 text-left transition-colors";
  const cardClass = (on: boolean) =>
    `${cardBase} ${on ? "border-accent-600 bg-accent-50" : "border-gray-200 bg-white hover:bg-gray-50"}`;
  const rows = menusQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">메뉴 관리</h1>
        <button
          type="button"
          onClick={() => openForm(null)}
          className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700"
        >
          + 메뉴 추가
        </button>
      </div>

      {toast && (
        <div
          key={toast.text}
          role="status"
          onAnimationEnd={() => setToast(null)}
          className={`fp-toast fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-xs font-bold shadow-lg ${
            toast.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* 메뉴 유형 카드: 누르면 아래 표를 그 유형으로 거른다 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="menu-category-cards">
        <button
          type="button"
          aria-pressed={categoryFilter === ""}
          onClick={() => setCategoryFilter("")}
          className={cardClass(categoryFilter === "")}
        >
          <div className="text-sm font-semibold text-gray-900">전체</div>
          <div className="text-xs text-gray-500">{totalMenus}개</div>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={categoryFilter === c.name}
            onClick={() => setCategoryFilter(categoryFilter === c.name ? "" : c.name)}
            className={cardClass(categoryFilter === c.name)}
          >
            <div className="text-sm font-semibold text-gray-900">{c.name}</div>
            <div className="text-xs text-gray-500">{c.menu_count}개</div>
          </button>
        ))}
        {newCategory === null ? (
          <button
            type="button"
            onClick={() => setNewCategory("")}
            className={`${cardBase} border-dashed border-gray-300 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50`}
          >
            + 유형 추가
          </button>
        ) : (
          <form onSubmit={submitCategory} className={`${cardBase} border-accent-600 bg-white`}>
            <label htmlFor="menu-new-category" className="sr-only">새 메뉴 유형</label>
            <input
              id="menu-new-category"
              autoFocus
              value={newCategory}
              maxLength={50}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setNewCategory(null)}
              placeholder="예: 뇨끼"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="submit"
                disabled={categoryMutation.isPending}
                className="rounded bg-accent-600 px-2 py-0.5 text-xs font-semibold text-white"
              >
                추가
              </button>
              <button
                type="button"
                onClick={() => setNewCategory(null)}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700"
              >
                취소
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="menumanagement-f3" className="mb-1 block text-xs font-semibold text-gray-600">판매 상태</label>
          <select id="menumanagement-f3"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent-600"
          >
            <option value="all">전체</option>
            <option value="active">운영중</option>
            <option value="inactive">출시대기</option>
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="menumanagement-f1" className="mb-1 block text-xs font-semibold text-gray-600">메뉴 이름 검색</label>
          <input id="menumanagement-f1"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="예: 까르보나라"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent-600"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {menusQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-600">메뉴 목록을 불러오는 중입니다...</div>
        ) : menusQuery.isError ? (
          <div className="p-8 text-center text-sm text-red-700">
            <p className="font-semibold">메뉴 목록 조회에 실패했습니다.</p>
            <p className="mt-1 text-xs text-gray-600">백엔드 서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-base font-semibold text-gray-800">
              {categoryFilter || searchInput || statusFilter !== "all" ? "조건에 맞는 메뉴가 없습니다." : "아직 등록된 메뉴가 없습니다."}
            </p>
            <button
              type="button"
              onClick={() => openForm(null)}
              className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
            >
              + 메뉴 추가
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-gray-200 text-xs font-medium text-gray-600">
              <tr>
                <th className="px-4 py-3 text-right">no</th>
                <th className="px-4 py-3">종류</th>
                <th className="px-4 py-3">메뉴 이름</th>
                <th className="px-4 py-3 text-right">가격</th>
                <th className="px-4 py-3">운영</th>
                <th className="px-4 py-3">레시피</th>
                <th className="px-4 py-3"><span className="sr-only">레시피 보기</span></th>
                <th className="px-4 py-3"><span className="sr-only">수정</span></th>
                <th className="px-4 py-3"><span className="sr-only">삭제</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((item, i) => (
                <tr key={item.id} className={item.is_active ? "" : "bg-gray-50 text-gray-500"}>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3">{item.category ?? <span className="text-xs text-gray-400">-</span>}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.selling_price !== null ? formatKrwPrice(item.selling_price) : <span className="text-xs text-gray-400">미입력</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => updateMutation.mutate({ menuId: item.id, payload: { is_active: !item.is_active } })}
                      disabled={updateMutation.isPending}
                      title="눌러서 바꾸기"
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        item.is_active ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {item.is_active ? "운영중" : "출시대기"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold">{renderRecipe(item)}</td>
                  <td className="px-2 py-3">
                    <button type="button" onClick={() => setRecipeTarget(item)} className="text-xs font-semibold text-accent-700 hover:underline">
                      보기
                    </button>
                  </td>
                  <td className="px-2 py-3">
                    <button type="button" onClick={() => openForm(item)} className="text-xs font-medium text-gray-700 hover:underline">
                      수정
                    </button>
                  </td>
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      disabled={deleteMutation.isPending}
                      className="text-xs font-medium text-red-700 hover:underline"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
          setToast({ type: "success", text: `'${recipeTarget?.name}' 레시피를 저장했습니다.` });
        }}
      />
    </div>
  );
}
