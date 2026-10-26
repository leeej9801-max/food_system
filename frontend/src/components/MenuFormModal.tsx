import { useEffect, useState } from "react";
import { ApiClientError } from "../api/client";
import { formatKrwPrice, validateMenuForm } from "../lib/menuValidation";
import type { MenuItem } from "../types";

interface MenuFormModalProps {
  open: boolean;
  initialMenu: MenuItem | null;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    selling_price: number | null;
    category: string | null;
    description: string | null;
    is_active: boolean;
  }) => Promise<void>;
}

export function MenuFormModal({ open, initialMenu, onClose, onSubmit }: MenuFormModalProps) {
  const [name, setName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setGeneralError(null);
    if (initialMenu) {
      setName(initialMenu.name);
      setSellingPrice(
        initialMenu.selling_price !== null ? String(Math.round(Number(initialMenu.selling_price))) : ""
      );
      setCategory(initialMenu.category ?? "");
      setDescription(initialMenu.description ?? "");
      setIsActive(initialMenu.is_active);
    } else {
      setName("");
      setSellingPrice("");
      setCategory("");
      setDescription("");
      setIsActive(true);
    }
  }, [open, initialMenu]);

  if (!open) return null;

  const isDirty =
    name.trim() !== (initialMenu?.name ?? "") ||
    category.trim() !== (initialMenu?.category ?? "");

  function handleSafeClose() {
    if (submitting) return;
    if (isDirty && !window.confirm("저장하지 않은 입력 내용이 있습니다. 닫으시겠습니까?")) {
      return;
    }
    onClose();
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError(null);
    const validation = validateMenuForm({
      name,
      sellingPrice,
      category,
      description,
      isActive,
    });
    if (!validation.valid || !validation.normalizedPayload) {
      setFieldErrors(validation.errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(validation.normalizedPayload);
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setGeneralError(err.message);
        const mapped: Record<string, string> = {};
        for (const d of err.details) {
          mapped[d.field] = d.message;
        }
        setFieldErrors(mapped);
      } else {
        setGeneralError("저장 중 네트워크 또는 서버 오류가 발생했습니다. 입력값은 유지됩니다.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="text-lg font-bold text-slate-900">
            {initialMenu ? "메뉴 수정" : "새 메뉴 추가"}
          </h2>
          <button
            type="button"
            onClick={handleSafeClose}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            닫기
          </button>
        </div>

        {generalError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <strong>저장 실패:</strong> {generalError}
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">
              메뉴명 <span className="text-red-600">* (필수)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 제육볶음"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-none"
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.name}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-800">
                판매가격 (선택, 원)
              </label>
              <input
                type="number"
                min={0}
                step={100}
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="비워두면 미입력 상태"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">
                표시 미리보기: {formatKrwPrice(sellingPrice)}
              </p>
              {fieldErrors.selling_price && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  {fieldErrors.selling_price}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-800">
                카테고리 (선택)
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예: 식사, 안주, 음료"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline-none"
              />
              {fieldErrors.category && (
                <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.category}</p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">
              설명 / 메모 (선택)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="선택 입력: 비워두어도 저장 및 판매 수집이 가능합니다."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
            />
            {fieldErrors.description && (
              <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.description}</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <div>
              <span className="text-sm font-medium text-slate-800">판매 활성 상태</span>
              <p className="text-xs text-slate-500">
                비활성화해도 과거 판매·원가 이력은 삭제되지 않습니다.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300"
              />
              <span className="text-sm font-semibold text-slate-800">
                {isActive ? "판매중(활성)" : "비활성(보관)"}
              </span>
            </label>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>안내 (PROVISIONAL):</strong> POS 외부 상품 매핑 및 1인분 레시피 식자재 연결은
            후속 단계에서 활성화됩니다. 현재는 메뉴 마스터만 먼저 등록됩니다.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleSafeClose}
              disabled={submitting}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "저장 중..." : initialMenu ? "변경 저장" : "메뉴 추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
