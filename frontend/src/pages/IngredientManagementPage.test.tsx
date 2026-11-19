import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getIngredientPage,
  getTopRestockIngredients,
  IngredientManagementPage,
  RestockHeroCard,
} from "./IngredientManagementPage";
import { useUrlState } from "../lib/useUrlState";
import type {
  Ingredient,
  IngredientInventoryItem,
  Store,
} from "../types";

const captured = vi.hoisted(() => ({
  setFilterCalls: [] as string[],
}));

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
  stockStatus: IngredientInventoryItem["stock_status"] = "LOW_STOCK",
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
    last_counted_at: "2026-11-18T14:00:00Z",
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: estimatedQuantity,
    stock_status: stockStatus,
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
      inventoryItem("ing-1", "관찰레", "500.000", "400.000"),
      inventoryItem("ing-2", "올리브오일", "1000.000", "100.000"),
      inventoryItem("ing-3", "페코리노", "400.000", "-40.000"),
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
    const top = getTopRestockIngredients(list, []);
    expect(top.map((i) => i.name)).toEqual(["재료B", "재료A"]);
  });
});

describe("식자재 관리 화면 (v4 KPI 시안)", () => {
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
    inventory = [inventoryItem("ing-1", "검증 식자재 1", "500.000", "1000.000", "OK")],
    search = "",
  } = {}) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    clients.push(client);
    client.setQueryData(["ingredients", store.id, "all"], ingredients);
    client.setQueryData(["inventory-summary", store.id, "active"], inventory);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/ingredients${search}`]}>
          <IngredientManagementPage store={store} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("3장 KPI 카드·전체 보기 버튼·상태 알약 탭·재고 실사/식자재 추가 버튼·안전재고 슬라이더를 표시한다", () => {
    const html = renderPage();
    expect(html).toContain("재고 평가금액");
    expect(html).toContain("전체 보기 →");
    expect(html).toContain("재고 상태");
    expect(html).not.toContain("보충 예상금액");
    expect(html).toContain("입고 등록 →");
    expect(html).toContain("확인 필요");
    expect(html).not.toContain("소진 기록 없음");
    expect(html).toContain("레시피 미연결");
    expect(html).toContain("단가 미입력");
    expect(html).toContain("마지막 실사 11월 18일");
    expect(html.match(/\+ 식자재 추가/g)).toHaveLength(1);
    expect(html).toContain("재고 실사");
    expect(html).toContain("식자재 이름 검색");
    expect(html).toContain('aria-label="검증 식자재 1 안전재고"');
    expect(html).toContain('type="range"');
    expect(html).toContain('<th class="c">연결 메뉴</th>');
    expect(html).toContain('<th class="c">상태</th>');
    expect(html).toContain("PROVISIONAL");
    expect(html.indexOf("menu-table-region")).toBeLessThan(
      html.indexOf('aria-label="식자재 목록 페이지"'),
    );
    expect(useUrlState).toBeTypeOf("function");
  });

  it("상태 탭 및 확인 필요 조건(check)으로 표를 필터링하고 RestockHeroCard 키보드 동작을 지원한다", () => {
    const ingredients: Ingredient[] = [
      ingredient(1, { name: "관찰레", safety_stock: "500.000", stock_status: "NEEDS_RESTOCK" }),
      ingredient(2, {
        name: "소금",
        safety_stock: "300.000",
        stock_status: "IN_USE",
        linked_menu_count: 0,
      }),
    ];
    const inventory: IngredientInventoryItem[] = [
      inventoryItem("ing-1", "관찰레", "500.000", "200.000", "LOW_STOCK"),
      inventoryItem("ing-2", "소금", "300.000", "600.000", "OK"),
    ];

    const onSelect = vi.fn();
    const cardElement = RestockHeroCard({
      totalCount: 1,
      activeCount: 2,
      topItems: getTopRestockIngredients(ingredients, inventory),
      onSelect,
    });
    cardElement.props.onClick();
    expect(onSelect).toHaveBeenCalledTimes(1);
    const preventDefault = vi.fn();
    cardElement.props.onKeyDown({ key: "Enter", preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(2);

    const filteredHtml = renderPage({
      ingredients,
      inventory,
      search: "?status=NEEDS_RESTOCK",
    });
    expect(filteredHtml).toContain('<button type="button" class="ing-name-btn">관찰레</button>');
    expect(filteredHtml).not.toContain('<button type="button" class="ing-name-btn">소금</button>');

    const unlinkedHtml = renderPage({
      ingredients,
      inventory,
      search: "?check=unlinked",
    });
    expect(unlinkedHtml).toContain('<button type="button" class="ing-name-btn">소금</button>');
    expect(unlinkedHtml).not.toContain('<button type="button" class="ing-name-btn">관찰레</button>');
    expect(unlinkedHtml).toContain('aria-label="레시피 미연결 필터 해제"');
  });
});
