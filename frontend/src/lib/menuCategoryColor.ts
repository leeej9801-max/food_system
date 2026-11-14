import type { BadgeVariant } from "@astryxdesign/core/Badge";

// 메뉴 유형(카테고리) 이름을 astryx Badge 색상에 결정적으로 대응시킨다.
const CATEGORY_VARIANTS: readonly BadgeVariant[] = [
  "blue",
  "teal",
  "purple",
  "green",
  "orange",
  "cyan",
  "pink",
  "yellow",
];

const CATEGORY_CLASS_BY_VARIANT: Partial<Record<BadgeVariant, string>> = {
  blue: "menu-category-tone-blue",
  teal: "menu-category-tone-teal",
  purple: "menu-category-tone-purple",
  green: "menu-category-tone-green",
  orange: "menu-category-tone-orange",
  cyan: "menu-category-tone-cyan",
  pink: "menu-category-tone-pink",
  yellow: "menu-category-tone-yellow",
  neutral: "menu-category-tone-neutral",
};

const KNOWN_CATEGORY_INDEX: Record<string, number> = {
  파스타: 0,
  식사: 0,
  스테이크: 1,
  뇨끼: 2,
  "음료/와인": 3,
  음료: 3,
  와인: 3,
  샐러드: 4,
  사이드: 5,
  디저트: 6,
};

export function getMenuCategoryVariant(category: string | null | undefined): BadgeVariant {
  const name = (category ?? "").trim();
  if (!name) return "neutral";
  const known = KNOWN_CATEGORY_INDEX[name];
  if (known !== undefined) {
    return CATEGORY_VARIANTS[known % CATEGORY_VARIANTS.length];
  }
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_VARIANTS[hash % CATEGORY_VARIANTS.length];
}

export function getMenuCategoryToneClass(category: string | null | undefined): string {
  const variant = getMenuCategoryVariant(category);
  return CATEGORY_CLASS_BY_VARIANT[variant] ?? "menu-category-tone-neutral";
}
