import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** 기본 <dialog>를 모달로 연다. 역할·Esc 닫기·바깥 비활성은 브라우저가 맡는다. */
export function Dialog({ label, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        // Esc: 브라우저가 바로 닫지 않게 막고, 닫기 판단(저장 안 한 입력 확인 등)은 부모에게 맡긴다.
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center overscroll-contain bg-transparent p-4 backdrop:bg-gray-900/50 open:flex"
    >
      {children}
    </dialog>
  );
}
