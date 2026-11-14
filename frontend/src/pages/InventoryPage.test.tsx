import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, ReactNode, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionDialog, InventoryPage } from "./InventoryPage";
import { InventoryHistoryDialog } from "../components/InventoryHistoryDialog";
import { createAdjustment, createCount, createReceipt, fetchInventorySummary, fetchReceipts } from "../api/inventory";
import { fetchMenus } from "../api/menus";
import { fetchMenuRecipe } from "../api/ingredients";
import {
  adjustmentDelta, filterInventory, filterReceipts, getInventoryPage, priceChanges, receiptSummary, shortageRanking,
} from "../lib/inventoryView";
import type { IngredientInventoryItem, InventoryReceipt, Store } from "../types";

type ElementProps = Record<string, unknown>;
const harness = vi.hoisted(() => ({
  cursor: 0,
  states: new Map<number, unknown>(),
  elements: [] as { type: string; props: ElementProps }[],
  queries: new Map<string, { data?: unknown; isLoading?: boolean; error?: Error | null; dataUpdatedAt?: number }>(),
  queryCalls: [] as { queryKey: unknown[]; queryFn: () => unknown; enabled?: boolean }[],
  pending: [] as Promise<unknown>[],
  invalidate: vi.fn(),
}));

// 기존 테스트와 같은 SSR. 이벤트 후 보존한 state로 다시 그리며 브라우저 검증과 구분한다.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = harness.cursor++;
    if (!harness.states.has(index)) harness.states.set(index, typeof initial === "function" ? (initial as () => T)() : initial);
    return [harness.states.get(index) as T, (next: SetStateAction<T>) => {
      harness.states.set(index, typeof next === "function" ? (next as (previous: T) => T)(harness.states.get(index) as T) : next);
    }];
  },
}));
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: unknown, props: unknown) => {
    if (typeof type === "string") harness.elements.push({ type, props: props as ElementProps });
  };
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { record(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { record(args[0], args[1]); return actual.jsxs(...args); },
  };
});
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (typeof args[0] === "string") harness.elements.push({ type: args[0], props: args[1] as ElementProps });
      return actual.jsxDEV(...args);
    },
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: harness.invalidate }),
  useQuery: (options: typeof harness.queryCalls[number]) => {
    harness.queryCalls.push(options);
    const result = harness.queries.get(JSON.stringify(options.queryKey));
    return { data: result?.data, isLoading: result?.isLoading ?? false, isError: Boolean(result?.error), error: result?.error ?? null, dataUpdatedAt: result?.dataUpdatedAt ?? 0 };
  },
  useMutation: (options: { mutationFn: () => Promise<unknown>; onSuccess: (result: unknown) => void; onError: (error: unknown) => void }) => ({
    isPending: false,
    mutate: () => harness.pending.push(options.mutationFn().then(options.onSuccess).catch(options.onError)),
  }),
}));
vi.mock("@astryxdesign/core/theme", () => ({ Theme: ({ children }: { children: ReactNode }) => children }));
vi.mock("@astryxdesign/core/SegmentedControl", () => ({
  SegmentedControl: (props: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) => (
    <div role="radiogroup" aria-label={props.label} data-value={props.value} onChange={(event) => props.onChange(event.type)}>{props.children}</div>
  ),
  SegmentedControlItem: (props: { value: string; label: string; isDisabled?: boolean }) => (
    <button type="button" role="radio" value={props.value} disabled={props.isDisabled}>{props.label}</button>
  ),
}));
vi.mock("@astryxdesign/core/Pagination", () => ({
  Pagination: (props: { label: string; page: number; onChange: (page: number) => void }) => (
    <nav aria-label={props.label} data-page={props.page} onChange={(event) => props.onChange(Number(event.type))} />
  ),
}));
vi.mock("@astryxdesign/core/Tooltip", () => ({
  Tooltip: (props: { children: ReactNode; content: string; touchTrigger: string; focusTrigger: string }) => (
    <span data-tooltip={props.content} data-touch={props.touchTrigger} data-focus={props.focusTrigger}>{props.children}</span>
  ),
}));
vi.mock("../components/AppLink", () => ({ AppLink: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("../components/Dialog", () => ({ Dialog: ({ label, children }: { label: string; children: ReactNode }) => <div role="dialog" aria-label={label}>{children}</div> }));
vi.mock("../api/inventory", () => ({ createAdjustment: vi.fn(), createCount: vi.fn(), createReceipt: vi.fn(), fetchInventorySummary: vi.fn(), fetchReceipts: vi.fn() }));
vi.mock("../api/menus", () => ({ fetchMenus: vi.fn() }));
vi.mock("../api/ingredients", () => ({ fetchMenuRecipe: vi.fn() }));

const store: Store = {
  id: "test-store", name: "검증 매장", timezone: "Asia/Seoul", business_days: null, opening_hours: null,
  floor_fixtures: [], created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z",
};
function item(index: number, overrides: Partial<IngredientInventoryItem> = {}): IngredientInventoryItem {
  return {
    ingredient_id: `ingredient-${index}`, ingredient_name: `검증 식자재 ${index}`, is_active: true,
    base_unit: "g", purchase_unit: "kg", conversion_factor: "1000", safety_stock: "100",
    latest_unit_cost_per_purchase: "10000", latest_unit_cost_per_base: "10", cost_basis_label: "",
    last_actual_quantity: "100", last_counted_at: "2026-11-14T18:00:00Z", receipts_since_count_base: "0",
    theoretical_consumption_base: "0", adjustments_since_count_base: "0", estimated_quantity: "150", stock_status: "OK",
    ...overrides,
  };
}
function receipt(index: number, ingredientIndex = index): InventoryReceipt {
  return {
    id: `receipt-${index}`, store_id: store.id, ingredient_id: `ingredient-${ingredientIndex}`, ingredient_name: `검증 식자재 ${ingredientIndex}`,
    purchase_quantity: "1", purchase_unit: "kg", base_quantity: "1000", base_unit: "g", total_cost: "10000",
    unit_cost_per_purchase: "10000", unit_cost_per_base: "10", supplier_name: null, notes: null, received_at: "2026-11-15T00:00:00Z",
  };
}
function query(key: unknown[], data: unknown) { harness.queries.set(JSON.stringify(key), { data }); }
function render(node: ReactNode = <InventoryPage store={store} />) {
  harness.cursor = 0;
  harness.elements.length = 0;
  harness.queryCalls.length = 0;
  renderToStaticMarkup(node);
  // 렌더 중 페이지 보정을 SSR의 다음 렌더에 반영한다.
  harness.cursor = 0;
  harness.elements.length = 0;
  return renderToStaticMarkup(node);
}
function element(type: string, key: string, value: unknown) {
  const found = harness.elements.find((entry) => entry.type === type && entry.props[key] === value);
  expect(found, `${type} ${key}=${String(value)}`).toBeDefined();
  return found!.props;
}
function click(label: string) { (element("button", "children", label).onClick as () => void)(); }
function change(label: string, value: string) {
  const control = harness.elements.find((entry) => entry.props["aria-label"] === label && ["input", "select"].includes(entry.type));
  expect(control).toBeDefined();
  (control!.props.onChange as (event: unknown) => void)({ target: { value } });
}
function segment(label: string, value: string) { (element("div", "aria-label", label).onChange as (event: unknown) => void)({ type: value }); }
async function submit() {
  const form = harness.elements.find((entry) => entry.type === "form");
  (form!.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
  await Promise.all(harness.pending.splice(0));
}
beforeEach(() => {
  harness.cursor = 0;
  harness.states.clear();
  harness.elements.length = 0;
  harness.queries.clear();
  harness.pending.length = 0;
  vi.clearAllMocks();
  query(["inventory-summary", store.id], [item(1), item(2, { stock_status: "LOW_STOCK", estimated_quantity: "30" }), item(3, { stock_status: "NEGATIVE_WARNING", estimated_quantity: "-5" })]);
  query(["inventory-receipts", store.id], [receipt(1), receipt(2)]);
});

describe("재고 필터·페이지·요약", () => {
  it("기존 상태를 그대로 거르고 입고 필요는 부족·점검을 묶는다", () => {
    const items = [item(1), item(2, { stock_status: "LOW_STOCK" }), item(3, { stock_status: "NEGATIVE_WARNING" })];
    expect(filterInventory(items, "all")).toEqual(items);
    expect(filterInventory(items, "OK")).toEqual([items[0]]);
    expect(filterInventory(items, "LOW_STOCK")).toEqual([items[1]]);
    expect(filterInventory(items, "NEGATIVE_WARNING")).toEqual([items[2]]);
    expect(filterInventory(items, "needs_receipt")).toEqual(items.slice(1));
  });
  it("20행 경계·빈 목록·축소된 목록과 잘못된 페이지를 처리한다", () => {
    const items = Array.from({ length: 41 }, (_, index) => item(index + 1));
    expect(getInventoryPage(items, 1).rows).toHaveLength(20);
    expect(getInventoryPage(items, 2).rows[0].ingredient_id).toBe("ingredient-21");
    expect(getInventoryPage(items, 3)).toMatchObject({ pageCount: 3, offset: 40, rows: [items[40]] });
    expect(getInventoryPage(items.slice(0, 40), 3).page).toBe(2);
    expect(getInventoryPage(items.slice(0, 20), 2).pageCount).toBe(1);
    expect(getInventoryPage(items.slice(0, 21), 2).rows).toHaveLength(1);
    expect(getInventoryPage([], 4)).toEqual({ page: 1, pageCount: 1, offset: 0, rows: [] });
    for (const page of [0, -2, NaN, Infinity]) expect(getInventoryPage(items, page).page).toBe(1);
  });
  it("단위가 다른 재료를 부족률로 비교하고 안전재고 없는 항목을 순위에서 제외한다", () => {
    const ranking = shortageRanking([
      item(1, { stock_status: "LOW_STOCK", safety_stock: "1000", estimated_quantity: "900" }),
      item(2, { stock_status: "LOW_STOCK", base_unit: "ea", safety_stock: "2", estimated_quantity: "0" }),
      item(3, { stock_status: "NEGATIVE_WARNING", estimated_quantity: "-50" }),
      item(4, { stock_status: "NEGATIVE_WARNING", safety_stock: null }),
      item(5, { stock_status: "LOW_STOCK", safety_stock: "0" }),
    ]);
    expect(ranking.map((row) => row.item.ingredient_id)).toEqual(["ingredient-3", "ingredient-2", "ingredient-1"]);
    expect(ranking.map((row) => row.shortage)).toEqual([1.5, 1, 0.1]);
  });
  it("7일 경계·미래 입고를 구분하고 실제 금액과 최근 입고일을 합산한다", () => {
    const now = Date.parse("2026-11-15T00:00:00Z");
    const rows = [
      { ...receipt(1), received_at: "2026-11-08T00:00:00Z", total_cost: "0.10" },
      { ...receipt(2), total_cost: "0.20" },
      { ...receipt(3), received_at: "2026-11-07T23:59:59Z" },
      { ...receipt(4), received_at: "2026-11-16T00:00:00Z" },
    ];
    expect(receiptSummary(rows, now)).toEqual({ latest: rows[3].received_at, count: 2, amount: 0.3 });
    expect(receiptSummary([], now)).toEqual({ latest: null, count: 0, amount: 0 });
  });
});

describe("재고 화면 연결", () => {
  it("화면 진입 후 입고를 저장하고 재조회하면 최근 7일 요약에 반영한다", () => {
    const now = Date.parse("2026-11-15T00:00:00Z");
    const key = JSON.stringify(["inventory-receipts", store.id]);
    harness.queries.set(key, { data: [receipt(1)], dataUpdatedAt: now });
    expect(render()).toContain("1건");
    harness.queries.set(key, {
      data: [receipt(1), { ...receipt(2), received_at: "2026-11-15T00:01:00Z" }],
      dataUpdatedAt: now + 120_000,
    });
    const html = render();
    expect(html).toContain("2건");
    expect(html).toContain("20,000원");
  });
  it("파란 카드 클릭 후 입고 필요 탭과 실제 표가 함께 바뀐다", () => {
    render();
    (element("section", "aria-label", "입고 필요 2종 재고 보기").onClick as () => void)();
    const html = render();
    expect(element("div", "aria-label", "재고 상태")["data-value"]).toBe("needs_receipt");
    const body = html.split("<tbody>")[1].split("</tbody>")[0];
    expect(body).not.toContain("검증 식자재 1");
    expect(body).toContain("검증 식자재 2");
    expect(body).toContain("검증 식자재 3");
    for (const [status, name] of [["OK", "1"], ["LOW_STOCK", "2"], ["NEGATIVE_WARNING", "3"]]) {
      segment("재고 상태", status);
      const filteredHtml = render().split("<tbody>")[1].split("</tbody>")[0];
      expect(filteredHtml.match(/<tr>/g)).toHaveLength(1);
      expect(filteredHtml).toContain(`검증 식자재 ${name}`);
    }
  });
  it.each(["Enter", " "])("파란 카드를 %s 키로 선택할 수 있다", (key) => {
    render();
    const card = element("section", "aria-label", "입고 필요 2종 재고 보기");
    expect(card.role).toBe("button");
    expect(card.tabIndex).toBe(0);
    const preventDefault = vi.fn();
    (card.onKeyDown as (event: unknown) => void)({ key, preventDefault });
    render();
    expect(preventDefault).toHaveBeenCalled();
    expect(element("div", "aria-label", "재고 상태")["data-value"]).toBe("needs_receipt");
  });
  it("페이지 이동·상태 변경·조회 축소 시 표와 페이지를 동기화한다", () => {
    const items = Array.from({ length: 41 }, (_, index) => item(index + 1));
    query(["inventory-summary", store.id], items);
    render();
    (element("nav", "aria-label", "재고 목록 페이지").onChange as (event: unknown) => void)({ type: "3" });
    expect(render()).toContain("41–41 / 41종");
    query(["inventory-summary", store.id], items.slice(0, 40));
    expect(render()).toContain("21–40 / 40종");
    segment("재고 상태", "OK");
    expect(render()).toContain("1–20 / 40종");
    expect(element("nav", "aria-label", "재고 목록 페이지")["data-page"]).toBe(1);
  });
  it("실사 수량은 날짜 없이 정렬하고 정보 버튼은 터치·포커스 툴팁을 사용한다", () => {
    const html = render();
    expect(html).toContain('data-tooltip="최근 실사: 2026. 11. 15." data-touch="tap" data-focus="always"');
    expect(html).toContain('aria-label="검증 식자재 1 최근 실사: 2026. 11. 15."');
    expect(html).toContain('<span>100g</span>');
    expect(html).not.toContain("(2026. 11. 15.)");
    expect(html).not.toContain("<details");
  });
  it.each(["입고 등록", "폐기·보정", "실사 입력"])("빠른 기록 %s가 기존 저장 모달을 연다", (label) => {
    render();
    // 행 버튼과 이름이 같으면 먼저 나타나는 상단 버튼을 선택한다.
    click(label);
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="식자재"');
  });
  it("빈 목록과 오류는 0건 데이터로 위장하지 않는다", () => {
    query(["inventory-summary", store.id], []);
    expect(render()).toContain("등록된 식자재가 없습니다");
    harness.queries.set(JSON.stringify(["inventory-summary", store.id]), { error: new Error("재고 조회 오류") });
    const html = render();
    expect(html).toContain("재고 조회 오류");
    expect(html).toContain("재고 조회 실패");
    expect(html).toContain("—종");
  });
  it("기존 읽기 API와 모달 이력 열기를 연결한다", async () => {
    render();
    await harness.queryCalls.find((call) => call.queryKey[0] === "inventory-summary")!.queryFn();
    await harness.queryCalls.find((call) => call.queryKey[0] === "inventory-receipts")!.queryFn();
    expect(fetchInventorySummary).toHaveBeenCalledWith(store.id, false);
    expect(fetchReceipts).toHaveBeenCalledWith(store.id);
    click("입고 · 단가 이력 >");
    expect(render()).toContain('aria-label="입고 · 단가 이력"');
  });
});

describe("폐기·보정과 기존 기록 계약", () => {
  function dialog(action: ComponentProps<typeof ActionDialog>["action"] = "ADJUST") {
    return <ActionDialog store={store} item={item(1)} items={[item(1), item(2)]} action={action}
      onSelect={vi.fn()} onClose={vi.fn()} onDone={vi.fn()} />;
  }
  it.each(["WASTE", "SPOILAGE", "CORRECTION", "OTHER"] as const)("%s의 부호와 사유·기본 단위 수량을 API로 보낸다", async (reason) => {
    const node = dialog();
    render(node);
    change("사유", reason);
    render(node);
    const isWaste = reason === "WASTE" || reason === "SPOILAGE";
    expect(element("button", "value", "+").disabled).toBe(isWaste);
    if (!isWaste) segment("보정 방향", "+");
    change("수량", "12.5");
    render(node);
    await submit();
    expect(createAdjustment).toHaveBeenLastCalledWith(store.id, {
      ingredient_id: "ingredient-1", quantity_delta: isWaste ? -12.5 : 12.5, reason, notes: null,
    });
    if (!isWaste) {
      segment("보정 방향", "-");
      render(node);
      await submit();
      expect(vi.mocked(createAdjustment).mock.calls.at(-1)?.[1].quantity_delta).toBe(-12.5);
    }
  });
  it("양수 보정에서 폐기 사유로 바꾸면 감소로 돌아간다", () => {
    const node = dialog();
    render(node); change("사유", "CORRECTION"); render(node); segment("보정 방향", "+"); render(node);
    change("사유", "SPOILAGE"); render(node);
    expect(element("div", "aria-label", "보정 방향")["data-value"]).toBe("-");
    expect(adjustmentDelta("5", "WASTE", "+")).toBe(-5);
  });
  it.each(["", "0", "-1", "NaN", "Infinity"])("잘못된 수량 %s은 전송하지 않고 오류를 표시한다", async (quantity) => {
    const node = dialog();
    render(node); change("수량", quantity); render(node); await submit();
    expect(createAdjustment).not.toHaveBeenCalled();
    expect(render(node)).toContain("수량은 0보다 커야 합니다.");
  });
  it("입고 구매 단위·금액과 실사 기본 단위 0을 유지한다", async () => {
    const node = dialog("RECEIPT");
    render(node); change("수량", "2");
    const cost = harness.elements.find((entry) => entry.type === "input" && entry.props.inputMode === "numeric")!;
    (cost.props.onChange as (event: unknown) => void)({ target: { value: "3000" } });
    render(node); await submit();
    expect(createReceipt).toHaveBeenCalledWith(store.id, { ingredient_id: "ingredient-1", purchase_quantity: 2, purchase_unit: "kg", total_cost: 3000, supplier_name: null, notes: null });
    harness.states.clear();
    const countNode = dialog("COUNT");
    render(countNode); change("실재고", "0"); render(countNode); await submit();
    expect(createCount).toHaveBeenCalledWith(store.id, { ingredient_id: "ingredient-1", actual_quantity: 0, notes: null });
  });
  it("저장 실패 시 입력과 오류를 유지한다", async () => {
    vi.mocked(createAdjustment).mockRejectedValueOnce(new Error("저장 실패"));
    const node = dialog();
    render(node); change("수량", "10"); render(node); await submit(); render(node);
    expect(element("input", "aria-label", "수량").value).toBe("10");
    expect(element("p", "role", "alert").children).toBe("저장 실패");
  });
});

describe("입고·단가 이력 필터", () => {
  const receipts = Array.from({ length: 55 }, (_, index) => receipt(index + 1, index % 3 + 1));
  const node = () => <InventoryHistoryDialog store={store} receipts={receipts} isLoading={false} error={null} onClose={vi.fn()} />;
  it("전체는 50건 제한 없이 보여 주고 식자재별 필터는 선택한 재료만 남긴다", () => {
    expect(filterReceipts(receipts, "all", "")).toHaveLength(55);
    expect(render(node()).match(/<tr>/g)).toHaveLength(56);
    segment("이력 필터", "ingredient"); render(node()); change("이력 식자재", "ingredient-2");
    const html = render(node());
    expect(html.split("<tbody>")[1]).not.toContain("검증 식자재 1");
    expect(html.split("<tbody>")[1]).toContain("검증 식자재 2");
  });
  it("메뉴 레시피 API로 연결된 여러 식자재의 이력만 표시한다", async () => {
    render(node()); segment("이력 필터", "menu"); render(node());
    expect(harness.queryCalls.find((call) => call.queryKey[0] === "menus")!.enabled).toBe(true);
    await harness.queryCalls.find((call) => call.queryKey[0] === "menus")!.queryFn();
    expect(fetchMenus).toHaveBeenCalledWith(store.id, { status: "all" });
    change("이력 메뉴", "menu-1");
    query(["menu-recipe", store.id, "menu-1"], { items: [{ ingredient_id: "ingredient-1" }, { ingredient_id: "ingredient-3" }] });
    const html = render(node());
    const recipeCall = harness.queryCalls.find((call) => call.queryKey[0] === "menu-recipe")!;
    expect(recipeCall.enabled).toBe(true);
    await recipeCall.queryFn();
    expect(fetchMenuRecipe).toHaveBeenCalledWith(store.id, "menu-1");
    const body = html.split("<tbody>")[1];
    expect(body).toContain("검증 식자재 1"); expect(body).toContain("검증 식자재 3"); expect(body).not.toContain("검증 식자재 2");
    expect(filterReceipts(receipts, "menu", "menu-1", ["ingredient-1", "ingredient-1", "ingredient-3"])).toHaveLength(37);
  });
  it("메뉴 변경 중 로딩·오류·빈 레시피를 전체 이력으로 보여 주지 않는다", () => {
    render(node()); segment("이력 필터", "menu"); render(node()); change("이력 메뉴", "menu-2");
    harness.queries.set(JSON.stringify(["menu-recipe", store.id, "menu-2"]), { isLoading: true });
    expect(render(node())).toContain("이력을 불러오는 중");
    harness.queries.set(JSON.stringify(["menu-recipe", store.id, "menu-2"]), { error: new Error("레시피 조회 실패") });
    expect(render(node())).toContain("레시피 조회 실패");
    query(["menu-recipe", store.id, "menu-2"], { items: [] });
    expect(render(node())).toContain("연결된 식자재가 없습니다.");
    expect(filterReceipts(receipts, "ingredient", "")).toEqual([]);
    expect(filterReceipts(receipts, "menu", "menu-2", [])).toEqual([]);
  });
  it("단가 변동은 시간순으로 최근 단가를 찾고 이력 2건부터 계산한다", () => {
    expect(priceChanges([receipt(1)])).toEqual([]);
    expect(priceChanges([
      { ...receipt(1, 1), unit_cost_per_base: "10", received_at: "2026-11-10T00:00:00Z" },
      { ...receipt(2, 1), unit_cost_per_base: "30" },
    ])[0].percent).toBe(50);
  });
});
