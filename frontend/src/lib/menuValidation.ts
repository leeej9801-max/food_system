export interface MenuFormValues {
  name: string;
  sellingPrice: string;
  category: string;
  description: string;
  isActive: boolean;
}

export interface MenuFormValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  normalizedPayload?: {
    name: string;
    selling_price: number | null;
    category: string | null;
    description: string | null;
    is_active: boolean;
  };
}

export function validateMenuForm(values: MenuFormValues): MenuFormValidationResult {
  const errors: Record<string, string> = {};
  const trimmedName = values.name.trim();

  if (!trimmedName) {
    errors.name = "메뉴명을 입력해 주세요.";
  } else if (trimmedName.length > 100) {
    errors.name = "메뉴명은 100자 이하로 입력해 주세요.";
  }

  let parsedPrice: number | null = null;
  const trimmedPrice = values.sellingPrice.trim();
  if (trimmedPrice !== "") {
    const num = Number(trimmedPrice);
    if (!Number.isFinite(num) || num < 0) {
      errors.selling_price = "판매가격은 0원 이상의 숫자로 입력해 주세요.";
    } else if (num > 99999999) {
      errors.selling_price = "판매가격은 99,999,999원 이하로 입력해 주세요.";
    } else {
      parsedPrice = num;
    }
  }

  const trimmedCategory = values.category.trim();
  if (trimmedCategory.length > 50) {
    errors.category = "카테고리는 50자 이하로 입력해 주세요.";
  }

  const trimmedDescription = values.description.trim();
  if (trimmedDescription.length > 500) {
    errors.description = "설명은 500자 이하로 입력해 주세요.";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    normalizedPayload: {
      name: trimmedName,
      selling_price: parsedPrice,
      category: trimmedCategory ? trimmedCategory : null,
      description: trimmedDescription ? trimmedDescription : null,
      is_active: values.isActive,
    },
  };
}

export function formatKrwPrice(price: string | number | null): string {
  if (price === null || price === "") {
    return "미입력";
  }
  const num = Number(price);
  if (!Number.isFinite(num)) {
    return "미입력";
  }
  return `${Math.round(num).toLocaleString("ko-KR")}원`;
}
