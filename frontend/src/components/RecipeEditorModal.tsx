import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../api/client";
import { fetchIngredients, fetchMenuRecipe, upsertMenuRecipe } from "../api/ingredients";

interface RecipeEditorModalProps {
  open: boolean;
  storeId: string;
  menuId: string | null;
  menuName: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface DraftRow {
  ingredient_id: string;
  quantity: string;
  notes: string;
}

export function RecipeEditorModal({
  open,
  storeId,
  menuId,
  menuName,
  onClose,
  onSaved,
}: RecipeEditorModalProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [status, setStatus] = useState<"COMPLETE" | "PARTIAL">("COMPLETE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ingredientsQuery = useQuery({
    queryKey: ["ingredients", storeId, "all-for-recipe"],
    queryFn: () => fetchIngredients(storeId, { status: "all" }),
    enabled: open,
  });

  const recipeQuery = useQuery({
    queryKey: ["menu-recipe", storeId, menuId],
    queryFn: () => fetchMenuRecipe(storeId, menuId!),
    enabled: open && Boolean(menuId),
  });

  useEffect(() => {
    if (!open || !recipeQuery.data) return;
    setErrorMessage(null);
    setStatus(recipeQuery.data.status === "PARTIAL" ? "PARTIAL" : "COMPLETE");
    setRows(
      recipeQuery.data.items.map((ri) => ({
        ingredient_id: ri.ingredient_id,
        quantity: String(Number(ri.quantity)),
        notes: ri.notes ?? "",
      }))
    );
  }, [open, recipeQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!menuId) throw new Error("메뉴가 선택되지 않았습니다.");
      const cleaned: Array<{ ingredient_id: string; quantity: number; notes: string | null }> = [];
      const seen = new Set<string>();
      for (const r of rows) {
        if (!r.ingredient_id) {
          throw new Error("식자재를 선택해 주세요.");
        }
        if (seen.has(r.ingredient_id)) {
          throw new Error("동일한 식자재가 중복 선택되었습니다.");
        }
        seen.add(r.ingredient_id);
        const qty = Number(r.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error("1인분 사용량은 0보다 큰 숫자로 입력해 주세요.");
        }
        cleaned.push({
          ingredient_id: r.ingredient_id,
          quantity: qty,
          notes: r.notes.trim() || null,
        });
      }
      return upsertMenuRecipe(storeId, menuId, {
        status,
        items: cleaned,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menus", storeId] });
      queryClient.invalidateQueries({ queryKey: ["ingredients", storeId] });
      queryClient.invalidateQueries({ queryKey: ["menu-recipe", storeId, menuId] });
      queryClient.invalidateQueries({ queryKey: ["ingredient-usages", storeId] });
      onSaved?.();
      onClose();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setErrorMessage(err.message);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("레시피 저장 중 오류가 발생했습니다.");
      }
    },
  });

  if (!open || !menuId) return null;

  const ingredients = ingredientsQuery.data ?? [];
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

  function handleAddRow() {
    const firstAvailable = ingredients.find(
      (ing) => ing.is_active && !rows.some((r) => r.ingredient_id === ing.id)
    );
    setRows((prev) => [
      ...prev,
      {
        ingredient_id: firstAvailable?.id ?? ingredients[0]?.id ?? "",
        quantity: "100",
        notes: "",
      },
    ]);
  }

  function handleRemoveRow(index: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handleUpdateRow(index: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              ‘{menuName}’ 1인분 레시피 설정
            </h2>
            <p className="mt-0.5 text-[12px] text-gray-600">
              메뉴 관리와 식자재 화면이 같은 레시피를 함께 씁니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          >
            닫기
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <strong>오류:</strong> {errorMessage}
          </div>
        )}

        {recipeQuery.isLoading || ingredientsQuery.isLoading ? (
          <div className="p-6 text-center text-sm text-gray-500">
            레시피 및 식자재 정보를 불러오는 중입니다...
          </div>
        ) : ingredients.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            아직 등록된 식자재가 없습니다. <strong>식자재·레시피</strong> 화면에서 식자재를
            먼저 추가해 주세요.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span>
                현재 버전: <strong>v{recipeQuery.data?.version ?? 0}</strong> (변경 저장 시 버전과
                이력이 보존됩니다)
              </span>
              <div className="flex items-center gap-2">
                <label className="font-semibold text-gray-700">레시피 완성도 표시:</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "COMPLETE" | "PARTIAL")}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                >
                  <option value="COMPLETE">완성 (이론 소비량·원가 계산 반영)</option>
                  <option value="PARTIAL">일부 미입력 (작성 중 표시)</option>
                </select>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                등록된 식자재 항목이 없습니다. 아래 <strong>[+ 재료 행 추가]</strong> 버튼을 눌러
                1인분 기준 사용량을 등록하세요.
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {rows.map((row, idx) => {
                  const selectedIng = ingredientById.get(row.ingredient_id);
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-1 items-center gap-2 rounded-lg border border-gray-200 p-2.5 sm:grid-cols-[1.5fr_1fr_1.2fr_auto]"
                    >
                      <select
                        value={row.ingredient_id}
                        onChange={(e) => handleUpdateRow(idx, { ingredient_id: e.target.value })}
                        className="rounded border border-gray-300 px-2.5 py-1.5 text-sm"
                      >
                        {ingredients.map((ing) => (
                          <option key={ing.id} value={ing.id}>
                            {ing.name} ({ing.base_unit})
                            {!ing.is_active ? " [비활성]" : ""}
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.001}
                          step="any"
                          value={row.quantity}
                          onChange={(e) => handleUpdateRow(idx, { quantity: e.target.value })}
                          className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm tabular-nums"
                          placeholder="사용량"
                        />
                        <span className="min-w-8 text-xs font-semibold text-gray-600">
                          {selectedIng?.base_unit ?? "단위"}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => handleUpdateRow(idx, { notes: e.target.value })}
                        placeholder="메모 (선택, 예: 건면 기준)"
                        className="rounded border border-gray-300 px-2.5 py-1.5 text-xs"
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveRow(idx)}
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        제거
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleAddRow}
                className="rounded-lg border border-accent-300 bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-100"
              >
                + 재료 행 추가
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-accent-600 px-5 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
                >
                  {saveMutation.isPending ? "저장 중..." : "레시피 저장"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
