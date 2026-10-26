import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../api/client";
import {
  createIngredient,
  fetchIngredients,
  fetchIngredientUsages,
  updateIngredient,
} from "../api/ingredients";
import { fetchMenus } from "../api/menus";
import { RecipeEditorModal } from "../components/RecipeEditorModal";
import type { BaseUnitType, Ingredient, PurchaseUnitType, Store } from "../types";

interface IngredientManagementPageProps {
  store: Store;
}

export function IngredientManagementPage({ store }: IngredientManagementPageProps) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null);

  // 식자재 폼 상태
  const [name, setName] = useState("");
  const [baseUnit, setBaseUnit] = useState<BaseUnitType>("g");
  const [purchaseUnit, setPurchaseUnit] = useState<PurchaseUnitType>("kg");
  const [conversionFactor, setConversionFactor] = useState("1000");
  const [safetyStock, setSafetyStock] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // 연결된 메뉴 패널 및 공통 레시피 모달 상태
  const [selectedIngredientForUsage, setSelectedIngredientForUsage] = useState<Ingredient | null>(
    null
  );
  const [recipeModalTarget, setRecipeModalTarget] = useState<{
    menuId: string;
    menuName: string;
  } | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const ingredientsQuery = useQuery({
    queryKey: ["ingredients", store.id, searchInput, statusFilter],
    queryFn: () => fetchIngredients(store.id, { q: searchInput, status: statusFilter }),
  });

  const menusQuery = useQuery({
    queryKey: ["menus", store.id, "all-for-linking"],
    queryFn: () => fetchMenus(store.id, { status: "all" }),
  });

  const usagesQuery = useQuery({
    queryKey: ["ingredient-usages", store.id, selectedIngredientForUsage?.id],
    queryFn: () => fetchIngredientUsages(store.id, selectedIngredientForUsage!.id),
    enabled: Boolean(selectedIngredientForUsage),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("식자재명을 입력해 주세요.");
      }
      const conv = Number(conversionFactor);
      if (!Number.isFinite(conv) || conv <= 0) {
        throw new Error("단위 변환 계수는 0보다 큰 숫자로 입력해 주세요.");
      }
      const safety =
        safetyStock.trim() === "" ? null : Number(safetyStock.trim());
      if (safety !== null && (!Number.isFinite(safety) || safety < 0)) {
        throw new Error("기준 안전재고는 0 이상으로 입력해 주세요.");
      }

      const payload = {
        name: trimmedName,
        base_unit: baseUnit,
        purchase_unit: purchaseUnit,
        conversion_factor: conv,
        safety_stock: safety,
        notes: notes.trim() || null,
        is_active: isActive,
      };

      if (editingIng) {
        return updateIngredient(store.id, editingIng.id, payload);
      }
      return createIngredient(store.id, payload);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["ingredients", store.id] });
      setBanner({
        type: "success",
        text: `식자재 '${saved.name}' 항목이 저장되었습니다.`,
      });
      setFormOpen(false);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError || err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("식자재 저장에 실패했습니다.");
      }
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (ing: Ingredient) =>
      updateIngredient(store.id, ing.id, { is_active: !ing.is_active }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["ingredients", store.id] });
      setBanner({
        type: "success",
        text: `식자재 '${updated.name}' 상태가 변경되었습니다.`,
      });
    },
  });

  const conversionGuide = useMemo(() => {
    const conv = Number(conversionFactor);
    if (!Number.isFinite(conv) || conv <= 0) return "유효한 변환값을 입력하세요";
    return `구매 1 ${purchaseUnit} = 레시피/재고 기준 ${conv.toLocaleString("ko-KR")} ${baseUnit}`;
  }, [purchaseUnit, baseUnit, conversionFactor]);

  function openCreateModal() {
    setEditingIng(null);
    setName("");
    setBaseUnit("g");
    setPurchaseUnit("kg");
    setConversionFactor("1000");
    setSafetyStock("");
    setNotes("");
    setIsActive(true);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditModal(ing: Ingredient) {
    setEditingIng(ing);
    setName(ing.name);
    setBaseUnit(ing.base_unit);
    setPurchaseUnit(ing.purchase_unit);
    setConversionFactor(String(Number(ing.conversion_factor)));
    setSafetyStock(ing.safety_stock !== null ? String(Number(ing.safety_stock)) : "");
    setNotes(ing.notes ?? "");
    setIsActive(ing.is_active);
    setFormError(null);
    setFormOpen(true);
  }

  function handlePresetUnit(pUnit: PurchaseUnitType, bUnit: BaseUnitType, factor: string) {
    setPurchaseUnit(pUnit);
    setBaseUnit(bUnit);
    setConversionFactor(factor);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">식자재 · 레시피 관리</h1>
          <p className="text-sm text-gray-600">
            식자재 마스터와 단위 변환 규칙(예: 구매 kg → 레시피 g)을 정의하고, 메뉴별 1인분 사용
            레시피를 양방향으로 연결합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700"
        >
          + 식자재 추가
        </button>
      </div>

      {banner && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
            banner.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-xs underline">
            닫기
          </button>
        </div>
      )}

      {/* 검색 및 필터 */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">식자재명 검색</label>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="예: 스파게티면, 올리브오일, 생크림, 베이컨..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">등록 상태</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">전체 (사용중 + 비활성)</option>
            <option value="active">사용중(활성)만</option>
            <option value="inactive">비활성(보관)만</option>
          </select>
        </div>
      </div>

      {/* 식자재 목록 테이블 */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {ingredientsQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">
            식자재 목록을 불러오는 중입니다...
          </div>
        ) : (ingredientsQuery.data ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-base font-semibold text-gray-800">아직 등록된 식자재가 없습니다.</p>
            <p className="mt-1 text-sm text-gray-500">
              양식당 기본 식자재(예: 스파게티면, 올리브오일, 관찰레/베이컨, 파르미지아노 치즈 등)를
              먼저 등록해 보세요.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
            >
              + 첫 식자재 추가하기
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-gray-200 text-xs font-medium text-gray-600">
              <tr>
                <th className="px-4 py-3">식자재명</th>
                <th className="px-4 py-3">구매단위 → 기본단위 (변환비)</th>
                <th className="px-4 py-3">기준 안전재고</th>
                <th className="px-4 py-3">연결 메뉴 수</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(ingredientsQuery.data ?? []).map((ing) => (
                <tr
                  key={ing.id}
                  className={ing.is_active ? "bg-white" : "bg-gray-50 text-gray-500"}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div>{ing.name}</div>
                    {ing.notes && <div className="text-xs text-gray-500">{ing.notes}</div>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs text-gray-700">
                    1 {ing.purchase_unit} = {Number(ing.conversion_factor).toLocaleString("ko-KR")}{" "}
                    {ing.base_unit}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs">
                    {ing.safety_stock !== null ? (
                      `${Number(ing.safety_stock).toLocaleString("ko-KR")} ${ing.base_unit}`
                    ) : (
                      <span className="font-sans text-gray-500">미설정</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedIngredientForUsage(ing)}
                      className="rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700 hover:bg-accent-100"
                    >
                      {ing.linked_menu_count}개 메뉴 보기
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {ing.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                        ● 사용중
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                        ○ 비활성
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(ing)}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActiveMutation.mutate(ing)}
                        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        {ing.is_active ? "비활성화" : "재활성화"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 식자재별 연결 메뉴 & 빠른 레시피 편집 섹션 */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              메뉴 ↔ 식자재 레시피 빠른 연결
            </h2>
            <p className="text-xs text-gray-500">
              메뉴 화면과 식자재 화면 어느 쪽에서 수정해도 동일한 레시피 데이터가
              갱신됩니다.
            </p>
          </div>
          {selectedIngredientForUsage && (
            <span className="rounded bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-800">
              선택 식자재: {selectedIngredientForUsage.name} (사용 메뉴{" "}
              {(usagesQuery.data ?? []).length}개)
            </span>
          )}
        </div>

        {selectedIngredientForUsage && (
          <div className="mt-3 rounded-lg border border-accent-100 bg-accent-50/50 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <strong className="text-gray-800">
                ‘{selectedIngredientForUsage.name}’ 식자재를 사용하는 메뉴 목록:
              </strong>
              <button
                type="button"
                onClick={() => setSelectedIngredientForUsage(null)}
                className="text-gray-500 underline"
              >
                선택 해제
              </button>
            </div>
            {(usagesQuery.data ?? []).length === 0 ? (
              <p className="text-gray-500">아직 이 식자재를 사용하는 메뉴가 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {(usagesQuery.data ?? []).map((u) => (
                  <li key={u.menu_item_id} className="flex items-center justify-between">
                    <span>
                      • <strong>{u.menu_name}</strong> — 1인분당{" "}
                      <code>
                        {Number(u.quantity)} {u.unit}
                      </code>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setRecipeModalTarget({ menuId: u.menu_item_id, menuName: u.menu_name })
                      }
                      className="rounded border border-accent-300 bg-white px-2 py-0.5 text-xs font-semibold text-accent-700 hover:bg-accent-50"
                    >
                      레시피 편집
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {(menusQuery.data ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-xs"
            >
              <div>
                <div className="font-semibold text-gray-800">{m.name}</div>
                <div className="text-gray-500">
                  {m.recipe_status === "COMPLETE"
                    ? `완성 (${m.recipe_item_count}종)`
                    : m.recipe_status === "PARTIAL"
                    ? `일부 미입력 (${m.recipe_item_count}종)`
                    : "레시피 미등록"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecipeModalTarget({ menuId: m.id, menuName: m.name })}
                className="rounded bg-gray-100 px-2.5 py-1 font-semibold text-gray-700 hover:bg-gray-200"
              >
                레시피 편집
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 식자재 추가/수정 모달 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
              <h2 className="text-lg font-bold text-gray-900">
                {editingIng ? "식자재 수정" : "새 식자재 추가"}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                닫기
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-800">
                  식자재명 <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 스파게티면, 엑스트라버진 올리브오일, 관찰레"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold text-gray-600">
                  자주 쓰는 단위 조합 빠른 선택:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePresetUnit("kg", "g", "1000")}
                    className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs hover:bg-gray-100"
                  >
                    구매 kg → 사용 g (×1,000)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetUnit("L", "ml", "1000")}
                    className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs hover:bg-gray-100"
                  >
                    구매 L → 사용 ml (×1,000)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetUnit("ea", "ea", "1")}
                    className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs hover:bg-gray-100"
                  >
                    개(ea) 단위 동일 (×1)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    구매 단위
                  </label>
                  <select
                    value={purchaseUnit}
                    onChange={(e) => setPurchaseUnit(e.target.value as PurchaseUnitType)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="ea">ea (개)</option>
                    <option value="pack">pack (팩/박스)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    레시피 기본 단위
                  </label>
                  <select
                    value={baseUnit}
                    onChange={(e) => setBaseUnit(e.target.value as BaseUnitType)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
                  >
                    <option value="g">g (그램)</option>
                    <option value="ml">ml (밀리리터)</option>
                    <option value="ea">ea (개)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    변환 계수
                  </label>
                  <input
                    type="number"
                    min={0.0001}
                    step="any"
                    value={conversionFactor}
                    onChange={(e) => setConversionFactor(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div className="rounded bg-accent-50 px-3 py-1.5 text-xs text-accent-800">
                단위 변환 미리보기: <strong>{conversionGuide}</strong>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  기준 안전재고 (선택, {baseUnit} 기준 — 미달 시 재고 알림)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={safetyStock}
                  onChange={(e) => setSafetyStock(e.target.value)}
                  placeholder={`예: 2000 (${baseUnit})`}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  보관/공급처 메모 (선택)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="예: 냉장 보관, 주요 공급처 OO식자재"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
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
                  {saveMutation.isPending ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <RecipeEditorModal
        open={Boolean(recipeModalTarget)}
        storeId={store.id}
        menuId={recipeModalTarget?.menuId ?? null}
        menuName={recipeModalTarget?.menuName ?? ""}
        onClose={() => setRecipeModalTarget(null)}
        onSaved={() =>
          setBanner({
            type: "success",
            text: `메뉴 '${recipeModalTarget?.menuName}' 레시피가 갱신되었습니다.`,
          })
        }
      />
    </div>
  );
}
