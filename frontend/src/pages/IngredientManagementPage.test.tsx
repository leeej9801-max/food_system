import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SegmentedControl } from "@astryxdesign/core/SegmentedControl";
import {
  getIngredientPage,
  getTopRestockIngredients,
  IngredientManagementPage,
  RestockHeroCard,
} from "./IngredientManagementPage";
import { getMenuCategoryToneClass } from "../lib/menuCategoryColor";
import { useUrlState } from "../lib/useUrlState";
import type {
  Ingredient,
  IngredientInsights,
  IngredientInventoryItem,
  MenuItem,
  Store,
} from "../types";

const captured = vi.hoisted(() => ({
  segmented: [] as ComponentProps<typeof SegmentedControl>[],
  setFilterCalls: [] as string[],
}));

vi.mock("@astryxdesign/core/SegmentedControl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/SegmentedControl")>();
  return {
    ...actual,
    SegmentedControl: (props: ComponentProps<typeof actual.SegmentedControl>) => {
      captured.segmented.push(props);
      return <actual.SegmentedControl {...props} />;
    },
  };
});

vi.mock("../lib/useUrlState", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/useUrlState")>();
  return {
    ...actual,
    useUrlState: <T extends string>(key: string, fallback: T, allowed?: readonly T[]) => {
      const [val, setVal] = actual.useUrlState(key, fallback, allowed);
      return [
        val,
        (next: T) => {
          captured.setFilterCalls.push(next);
          setVal(next);
        },
      ] as const;
    },
  };
});

const clients: QueryClient[] = [];
beforeEach(() => {
  captured.segmented.length = 0;
  captured.setFilterCalls.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

function ingredient(index: number, overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: `ing-${index}`,
    store_id: "test-store",
    name: `검증 식자재 ${index}`,
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "500.000",
    notes: null,
    is_active: true,
    linked_menu_count: 1,
    stock_status: "IN_USE",
    created_at: "2026-11-15T00:00:00Z",
    updated_at: "2026-11-15T00:00:00Z",
    ...overrides,
  };
}

function inventoryItem(
  ingredientId: string,
  name: string,
  safetyStock: string,
  estimatedQuantity: string,
): IngredientInventoryItem {
  return {
    ingredient_id: ingredientId,
    ingredient_name: name,
    is_active: true,
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: safetyStock,
    latest_unit_cost_per_purchase: "10000.00",
    latest_unit_cost_per_base: "10.0000",
    cost_basis_label: "",
    last_actual_quantity: null,
    last_counted_at: null,
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: estimatedQuantity,
    stock_status: "LOW_STOCK",
  };
}

describe("식자재 페이지 나누기", () => {
  const items = Array.from({ length: 42 }, (_, index) => ingredient(index + 1));

  it("20행씩 나누고 전체 목록 기준 행 번호를 유지한다", () => {
    const first = getIngredientPage(items, 1);
    const second = getIngredientPage(items, 2);
    const last = getIngredientPage(items, 3);
    expect(first.rows).toHaveLength(20);
    expect(second.rows).toHaveLength(20);
    expect(second.rows.map((r) => r.no)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 21),
    );
    expect(last.rows.map((r) => r.id)).toEqual(["ing-41", "ing-42"]);
    expect(last.rows[0].no).toBe(41);
    expect(last.pageCount).toBe(3);
  });

  it("필터 결과가 줄면 마지막 유효 페이지로 보정하고 경계를 안전하게 처리한다", () => {
    expect(getIngredientPage(items.slice(0, 40), 3).page).toBe(2);
    expect(getIngredientPage([], 4)).toEqual({ page: 1, pageCount: 1, offset: 0, rows: [] });
    for (const invalid of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getIngredientPage(items, invalid).page).toBe(1);
    }
  });
});

describe("입고 필요 상위 3개 정렬", () => {
  it("안전재고 대비 부족 비율 내림차순으로 상위 3개만 추린다", () => {
    const list: Ingredient[] = [
      ingredient(1, { name: "관찰레", safety_stock: "500.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(2, { name: "올리브오일", safety_stock: "1000.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(3, { name: "페코리노", safety_stock: "400.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(4, { name: "부채살", safety_stock: "2000.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(5, { name: "충분한재료", safety_stock: "500.000", stock_status: "IN_USE" }),
    ];
    const summary: IngredientInventoryItem[] = [
      // 관찰레: 안전재고 500, 추정 400 -> 부족 100 (20%)
      inventoryItem("ing-1", "관찰레", "500.000", "400.000"),
      // 올리브오일: 안전재고 1000, 추정 100 -> 부족 900 (90%)
      inventoryItem("ing-2", "올리브오일", "1000.000", "100.000"),
      // 페코리노: 안전재고 400, 추정 -40 -> 부족 440 (110%)
      inventoryItem("ing-3", "페코리노", "400.000", "-40.000"),
      // 부채살: 안전재고 2000, 추정 1000 -> 부족 1000 (50%)
      inventoryItem("ing-4", "부채살", "2000.000", "1000.000"),
    ];

    const top3 = getTopRestockIngredients(list, summary);
    expect(top3).toHaveLength(3);
    expect(top3.map((i) => i.name)).toEqual(["페코리노", "올리브오일", "부채살"]);
    expect(top3[0].shortage_amount).toBe(440);
    expect(top3[1].shortage_amount).toBe(900);
    expect(top3[2].shortage_amount).toBe(1000);
  });

  it("부족 비율이 같으면 부족량·안전재고·7일 사용량 순으로 정렬한다", () => {
    const list: Ingredient[] = [
      ingredient(1, { name: "재료A", safety_stock: "500.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(2, { name: "재료B", safety_stock: "1000.000", stock_status: "NEEDS_RESTOCK" }),
    ];
    // 재고 요약이 없을 때 둘 다 추정재고 0 -> 부족 비율 100% 동률, 부족량 1000 > 500
    const top = getTopRestockIngredients(list, []);
    expect(top.map((i) => i.name)).toEqual(["재료B", "재료A"]);
  });
});

describe("식자재 관리 화면", () => {
  const store: Store = {
    id: "test-store",
    name: "검증 매장",
    timezone: "Asia/Seoul",
    business_days: null,
    opening_hours: null,
    floor_fixtures: [],
    created_at: "2026-11-15T00:00:00Z",
    updated_at: "2026-11-15T00:00:00Z",
  };

  function renderPage({
    ingredients = [ingredient(1)],
    insights = {
      recent_usage: [{ ingredient_id: "ing-1", name: "검증 식자재 1", value: "120", unit: "g" }],
      linked_menus: [{ ingredient_id: "ing-1", name: "검증 식자재 1", value: "2", unit: "ea" }],
      menus_without_recipe: [
        { menu_id: "m-1", name: "까르보나라" },
        { menu_id: "m-2", name: "하우스 와인(글라스)" },
      ],
    } as IngredientInsights,
    inventory = [] as IngredientInventoryItem[],
    menus = [
      {
        id: "m-1",
        store_id: store.id,
        name: "까르보나라",
        category: "파스타",
        selling_price: "16000.00",
        description: null,
        is_active: true,
        pos_mapping_status: "LINKED",
        recipe_status: "UNREGISTERED",
        recipe_item_count: 0,
        created_at: "2026-11-15T00:00:00Z",
        updated_at: "2026-11-15T00:00:00Z",
      },
      {
        id: "m-2",
        store_id: store.id,
        name: "하우스 와인(글라스)",
        category: "음료/와인",
        selling_price: "9000.00",
        description: null,
        is_active: true,
        pos_mapping_status: "LINKED",
        recipe_status: "UNREGISTERED",
        recipe_item_count: 0,
        created_at: "2026-11-15T00:00:00Z",
        updated_at: "2026-11-15T00:00:00Z",
      },
    ] as MenuItem[],
    search = "",
  } = {}) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    clients.push(client);
    client.setQueryData(["ingredients", store.id, "all"], ingredients);
    client.setQueryData(["ingredients", store.id, "insights"], insights);
    client.setQueryData(["inventory-summary", store.id, "active"], inventory);
    client.setQueryData(["menus", store.id, "all-for-category"], menus);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/ingredients${search}`]}>
          <IngredientManagementPage store={store} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("툴바 배치·단일 식자재 추가 버튼·표 안 스크롤·페이지네이션·우측 카드 제목·유형 색 2열 그리드를 표시한다", () => {
    const html = renderPage();
    // 제목 줄 중복 없이 식자재 추가 버튼은 툴바에 1개만 있다
    expect(html.match(/\+ 식자재 추가/g)).toHaveLength(1);
    expect(html).toContain("식자재 검색");
    expect(html.indexOf("menu-table-region")).toBeLessThan(
      html.indexOf('aria-label="식자재 목록 페이지"'),
    );
    // 활성화(Switch) 열이 관리(MoreMenu) 열 왼쪽에 위치한다
    expect(html.indexOf('aria-label="검증 식자재 1 활성화"')).toBeLessThan(
      html.indexOf('aria-label="검증 식자재 1 메뉴"'),
    );
    // 우측 카드 변경된 제목 문구
    expect(html).toContain("최근 7일 식자재 사용량 순");
    expect(html).toContain("연결된 메뉴 많은 식자재 순");
    // 레시피 미등록 메뉴 2열 그리드 + 말줄임 + title + 유형 색 클래스
    expect(html).toContain("grid-cols-2");
    expect(html).toContain('title="까르보나라"');
    expect(html).toContain(getMenuCategoryToneClass("파스타"));
    expect(html).toContain(getMenuCategoryToneClass("음료/와인"));
    expect(useUrlState).toBeTypeOf("function");
  });

  it("입고 필요 강조 카드는 부족도 상위 3개만 표시하고 클릭·키보드 동작으로 입고 필요 상태 탭을 선택한다", () => {
    const ingredients: Ingredient[] = [
      ingredient(1, { name: "관찰레", safety_stock: "500.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(2, { name: "올리브오일", safety_stock: "1000.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(3, { name: "페코리노", safety_stock: "400.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(4, { name: "부채살", safety_stock: "2000.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(5, { name: "소금", safety_stock: "300.000", stock_status: "IN_USE" }),
    ];
    const inventory: IngredientInventoryItem[] = [
      inventoryItem("ing-1", "관찰레", "500.000", "400.000"),
      inventoryItem("ing-2", "올리브오일", "1000.000", "100.000"),
      inventoryItem("ing-3", "페코리노", "400.000", "-40.000"),
      inventoryItem("ing-4", "부채살", "2000.000", "1000.000"),
    ];
    const html = renderPage({ ingredients, inventory });
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="입고 필요 4종 보기"');
    // 상위 3개 순서: 페코리노 -> 올리브오일 -> 부채살 (4위 관찰레는 강조 카드 목록에서 제외)
    const cardStart = html.indexOf('aria-label="입고 필요 4종 보기"');
    const cardEnd = html.indexOf("최근 7일 식자재 사용량 순");
    const cardHtml = html.slice(cardStart, cardEnd);
    expect(cardHtml.indexOf("페코리노")).toBeLessThan(cardHtml.indexOf("올리브오일"));
    expect(cardHtml.indexOf("올리브오일")).toBeLessThan(cardHtml.indexOf("부채살"));
    expect(cardHtml).not.toContain("관찰레");

    // RestockHeroCard의 클릭 및 Enter/Space 키 핸들러 동작 검증
    const onSelect = vi.fn();
    const cardElement = RestockHeroCard({
      totalCount: 4,
      activeCount: 5,
      topItems: getTopRestockIngredients(ingredients, inventory),
      onSelect,
    });
    cardElement.props.onClick();
    expect(onSelect).toHaveBeenCalledTimes(1);
    const preventDefault = vi.fn();
    cardElement.props.onKeyDown({ key: "Enter", preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(2);
    cardElement.props.onKeyDown({ key: " ", preventDefault });
    expect(onSelect).toHaveBeenCalledTimes(3);

    // NEEDS_RESTOCK 탭이 선택되었을 때 상태 탭 값과 표 필터링 확인
    const filteredHtml = renderPage({
      ingredients,
      inventory,
      search: "?status=NEEDS_RESTOCK",
    });
    expect(captured.segmented.at(-1)?.value).toBe("NEEDS_RESTOCK");
    expect(filteredHtml).toContain("1–4 / 4개");
    expect(filteredHtml).not.toContain("소금");
  });
});
