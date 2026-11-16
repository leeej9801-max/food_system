import { useState } from "react";
import { Switch } from "@astryxdesign/core/Switch";
import { ApiClientError } from "../api/client";
import { formatKrwPrice, validateMenuForm } from "../lib/menuValidation";
import type { MenuItem } from "../types";

import { Dialog } from "./Dialog";

interface MenuFormModalProps {
  open: boolean;
  initialMenu: MenuItem | null;
  categories?: string[];
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    selling_price: number | null;
    category: string | null;
    description: string | null;
    is_active: boolean;
  }) => Promise<void>;
}

export function MenuFormModal({
  open,
  initialMenu,
  categories = [],
  onClose,
  onSubmit,
}: MenuFormModalProps) {
  const [name, setName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 열릴 때와 대상 메뉴가 바뀔 때 폼을 초기화한다. 효과 대신 렌더 중에 비교한다.
  const [prev, setPrev] = useState<{ open: boolean; initialMenu: MenuItem | null }>({
    open: false,
    initialMenu: null,
  });
  if (prev.open !== open || prev.initialMenu !== initialMenu) {
    setPrev({ open, initialMenu });
    if (open) {
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
    }
  }

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

  const input = "h-10 w-full rounded-xl bg-ground px-3 text-sm text-ink";
  const label = "block text-xs font-medium text-muted";
  const err = "mt-1 text-xs font-semibold text-[#b42318]";

  return (
    <Dialog label={initialMenu ? "메뉴 수정" : "새 메뉴 추가"} onClose={handleSafeClose}>
      <div className="card w-full max-w-lg shadow-xl">
        <div className="card-head">
          <h2>{initialMenu ? "메뉴 수정" : "새 메뉴 추가"}</h2>
          <button type="button" onClick={handleSafeClose} className="pill pill-sm pill-soft">
            닫기
          </button>
        </div>

        {generalError && (
          <div role="alert" className="mb-4 rounded-2xl bg-[#fdecec] px-4 py-2 text-sm font-semibold text-[#b42318]">
            저장 실패: {generalError}
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-3">
          <div>
            <label htmlFor="menuform-f1" className={label}>
              메뉴명 *
            </label>
            <input id="menuform-f1"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 제육볶음"
              className={`mt-1 ${input}`}
            />
            {fieldErrors.name && <p className={err}>{fieldErrors.name}</p>}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="menuform-f2" className={label}>
                판매가 (원)
              </label>
              <input id="menuform-f2"
                type="number"
                min={0}
                step={100}
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="비워두면 미입력"
                className={`mt-1 ${input} tabular-nums`}
              />
              <p className="mt-1 text-xs text-muted">{formatKrwPrice(sellingPrice)}</p>
              {fieldErrors.selling_price && <p className={err}>{fieldErrors.selling_price}</p>}
            </div>

            <div>
              <label htmlFor="menuform-f3" className={label}>
                종류
              </label>
              <input id="menuform-f3"
                type="text"
                list="menuform-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예: 파스타, 음료"
                className={`mt-1 ${input}`}
              />
              <datalist id="menuform-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {fieldErrors.category && <p className={err}>{fieldErrors.category}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="menuform-f4" className={label}>
              메모
            </label>
            <textarea id="menuform-f4"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="메모"
              className="mt-1 w-full rounded-xl bg-ground px-3 py-2 text-sm text-ink"
            />
            {fieldErrors.description && <p className={err}>{fieldErrors.description}</p>}
          </div>

          <Switch
            label={isActive ? "판매중" : "비활성"}
            value={isActive}
            onChange={setIsActive}
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={handleSafeClose} disabled={submitting} className="pill pill-sm pill-soft">
              취소
            </button>
            <button type="submit" disabled={submitting} className="pill pill-sm pill-primary">
              {submitting ? "저장 중..." : initialMenu ? "변경 저장" : "메뉴 추가"}
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
