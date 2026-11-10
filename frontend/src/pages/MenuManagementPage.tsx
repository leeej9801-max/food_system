import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createMenu, fetchMenus, updateMenu } from "../api/menus";
import { MenuFormModal } from "../components/MenuFormModal";
import { RecipeEditorModal } from "../components/RecipeEditorModal";
import { formatKrwPrice } from "../lib/menuValidation";
import { useUrlState } from "../lib/useUrlState";
import type { MenuItem, Store } from "../types";

interface MenuManagementPageProps {
  store: Store;
}

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
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const menusQuery = useQuery({
    queryKey: ["menus", store.id, searchInput, categoryFilter, statusFilter],
    queryFn: () =>
      fetchMenus(store.id, {
        q: searchInput,
        category: categoryFilter,
        status: statusFilter,
      }),
  });

  // REV-001 F-02 해소: 필터링 여부와 무관하게 전체 메뉴에서 카테고리 목록을 유지
  const allMenusQuery = useQuery({
    queryKey: ["menus", store.id, "all-categories"],
    queryFn: () => fetchMenus(store.id, { status: "all" }),
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of allMenusQuery.data ?? menusQuery.data ?? []) {
      if (item.category) set.add(item.category);
    }
    return Array.from(set).sort();
  }, [allMenusQuery.data, menusQuery.data]);

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createMenu>[1]) => createMenu(store.id, payload),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["menus", store.id] });
      queryClient.invalidateQueries({ queryKey: ["integration-status", store.id] });
      queryClient.invalidateQueries({ queryKey: ["analytics-sales", store.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
      setFeedbackBanner({
        type: "success",
        text: `메뉴 '${created.name}' 항목이 등록되었습니다.`,
      });
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
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["menus", store.id] });
      queryClient.invalidateQueries({ queryKey: ["integration-status", store.id] });
      queryClient.invalidateQueries({ queryKey: ["analytics-sales", store.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
      setFeedbackBanner({
        type: "success",
        text: `메뉴 '${updated.name}' 상태(${updated.is_active ? "판매중" : "비활성"})가 저장되었습니다.`,
      });
    },
    onError: (err: Error) => {
      setFeedbackBanner({
        type: "error",
        text: err.message || "메뉴 수정에 실패했습니다.",
      });
    },
  });

  function handleOpenCreate() {
    setEditingMenu(null);
    setModalOpen(true);
  }

  function handleOpenEdit(item: MenuItem) {
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

  function handleToggleActive(item: MenuItem) {
    updateMutation.mutate({
      menuId: item.id,
      payload: { is_active: !item.is_active },
    });
  }

  function renderRecipeBadge(item: MenuItem) {
    if (item.recipe_status === "COMPLETE") {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
          ● 완성 ({item.recipe_item_count}종)
        </span>
      );
    }
    if (item.recipe_status === "PARTIAL") {
      return (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
          ▲ 일부 미입력 ({item.recipe_item_count}종)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
        미등록
      </span>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">메뉴 관리</h1>
          <p className="text-sm text-gray-600">
            매장 메뉴 마스터와 1인분 레시피를 관리합니다. 선택 정보(가격·카테고리·레시피)가 비어
            있어도 저장 가능하며, 비활성화 시 과거 기록은 그대로 보존됩니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenCreate}
            className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700"
          >
            + 메뉴 추가
          </button>
        </div>
      </div>

      {feedbackBanner && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
            feedbackBanner.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <span>
            <strong>{feedbackBanner.type === "success" ? "완료:" : "오류:"}</strong>{" "}
            {feedbackBanner.text}
          </span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-xs underline"
          >
            닫기
          </button>
        </div>
      )}

      {/* 검색 및 필터 바 */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">메뉴명 검색</label>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="예: 까르보나라, 알리오올리오, 스테이크..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent-600 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">카테고리</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent-600 focus:outline-none"
          >
            <option value="">전체 카테고리</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">판매 상태</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent-600 focus:outline-none"
          >
            <option value="all">전체 (판매중 + 비활성)</option>
            <option value="active">판매중(활성)만</option>
            <option value="inactive">비활성(보관)만</option>
          </select>
        </div>
      </div>

      {/* 목록 테이블 */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {menusQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-600">
            메뉴 목록을 불러오는 중입니다...
          </div>
        ) : menusQuery.isError ? (
          <div className="p-8 text-center text-sm text-red-700">
            <p className="font-semibold">메뉴 목록 조회에 실패했습니다.</p>
            <p className="mt-1 text-xs text-gray-600">
              백엔드 서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.
            </p>
          </div>
        ) : (menusQuery.data ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-base font-semibold text-gray-800">아직 등록된 메뉴가 없습니다.</p>
            <p className="mt-1 text-sm text-gray-500">
              가짜 샘플 데이터를 표시하지 않습니다. 우측 상단 <strong>[+ 메뉴 추가]</strong> 버튼으로
              매장의 첫 메뉴를 등록하세요.
            </p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
            >
              + 첫 메뉴 추가하기
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-gray-200 text-xs font-medium text-gray-600">
              <tr>
                <th className="px-4 py-3">메뉴명</th>
                <th className="px-4 py-3">카테고리</th>
                <th className="px-4 py-3 text-right">판매가격</th>
                <th className="px-4 py-3">판매 상태</th>
                <th className="px-4 py-3">POS 연결</th>
                <th className="px-4 py-3">레시피</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(menusQuery.data ?? []).map((item) => (
                <tr
                  key={item.id}
                  className={item.is_active ? "bg-white" : "bg-gray-50 text-gray-500"}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div>{item.name}</div>
                    {item.description && (
                      <div className="text-xs text-gray-500">{item.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.category ? (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                        {item.category}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">미입력</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right">
                    {item.selling_price !== null ? (
                      formatKrwPrice(item.selling_price)
                    ) : (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-sans text-amber-800">
                        미입력
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                        ● 판매중(활성)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                        ○ 비활성(보관)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.pos_mapping_status === "LINKED" ? (
                      <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                        ● 연결됨 (POS/CSV)
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        대기 (이름 자동매칭)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{renderRecipeBadge(item)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setRecipeTarget(item)}
                        className="rounded border border-accent-300 bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-700 hover:bg-accent-100"
                      >
                        레시피
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(item)}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(item)}
                        disabled={updateMutation.isPending}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        {item.is_active ? "비활성화" : "재활성화"}
                      </button>
                    </div>
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
        onClose={() => setModalOpen(false)}
        onSubmit={handleModalSubmit}
      />

      <RecipeEditorModal
        open={Boolean(recipeTarget)}
        storeId={store.id}
        menuId={recipeTarget?.id ?? null}
        menuName={recipeTarget?.name ?? ""}
        onClose={() => setRecipeTarget(null)}
        onSaved={() =>
          setFeedbackBanner({
            type: "success",
            text: `메뉴 '${recipeTarget?.name}' 1인분 레시피가 저장되었습니다.`,
          })
        }
      />
    </div>
  );
}
