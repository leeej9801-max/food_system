import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Switch } from "@astryxdesign/core/Switch";
import { getMenuPage, MenuManagementPage } from "./MenuManagementPage";
import { updateMenu } from "../api/menus";
import type { CostSimulationResponse, MenuItem, SalesAnalyticsResponse, Store } from "../types";

const controls = vi.hoisted(() => ({
  switches: [] as ComponentProps<typeof Switch>[],
  toast: vi.fn(),
}));

vi.mock("@astryxdesign/core/Switch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@astryxdesign/core/Switch")>();
  return {
    ...actual,
    Switch: (props: ComponentProps<typeof actual.Switch>) => {
      controls.switches.push(props);
      return <actual.Switch {...props} />;
    },
  };
});
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@astryxdesign/core/Toast")>()),
  useToast: () => controls.toast,
}));
vi.mock("../api/menus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/menus")>()),
  updateMenu: vi.fn(),
}));

const clients: QueryClient[] = [];
beforeEach(() => {
  controls.switches.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

function menu(index: number): MenuItem {
  return {
    id: `menu-${index}`,
    store_id: "test-store",
    name: `검증 메뉴 ${index}`,
    category: "식사",
    selling_price: "12000.00",
    description: null,
    is_active: true,
    pos_mapping_status: "LINKED",
    recipe_status: "UNREGISTERED",
    recipe_item_count: 0,
    created_at: "2026-11-15T00:00:00Z",
    updated_at: "2026-11-15T00:00:00Z",
  };
}

describe("메뉴 페이지 나누기", () => {
  const menus = Array.from({ length: 41 }, (_, index) => menu(index + 1));

  it("20행씩 나누고 전체 목록 기준 행 번호를 유지한다", () => {
    const first = getMenuPage(menus, 1);
    const second = getMenuPage(menus, 2);
    const last = getMenuPage(menus, 3);
    expect(first.rows).toHaveLength(20);
    expect(second.rows).toHaveLength(20);
    expect(second.rows.map((row) => row.no)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 21),
    );
    expect(last.rows.map((row) => row.id)).toEqual(["menu-41"]);
    expect(last.rows[0].no).toBe(41);
    expect(last.pageCount).toBe(3);
    expect(menus[0]).not.toHaveProperty("no");
  });

  it("삭제·필터 결과가 줄면 마지막 유효 페이지로 보정한다", () => {
    const result = getMenuPage(menus.slice(0, 40), 3);
    expect(result.page).toBe(2);
    expect(result.rows).toHaveLength(20);
    expect(getMenuPage(menus.slice(0, 1), 3).page).toBe(1);
  });

  it("빈 목록과 페이지 경계를 안전하게 처리한다", () => {
    expect(getMenuPage([], 4)).toEqual({ page: 1, pageCount: 1, offset: 0, rows: [] });
    expect(getMenuPage(menus.slice(0, 20), 2).pageCount).toBe(1);
    expect(getMenuPage(menus.slice(0, 21), 2).rows).toHaveLength(1);
    for (const invalid of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getMenuPage(menus, invalid).page).toBe(1);
    }
  });
});

describe("메뉴 관리 화면 (v4 KPI 시안)", () => {
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

  const emptyCostData: CostSimulationResponse = {
    store_id: store.id,
    cost_basis_label: "최신 입고 단가",
    global_change_percent: "0",
    menus: [],
  };

  const emptySalesData: SalesAnalyticsResponse = {
    store_id: store.id,
    total_completed_orders: 0,
    total_quantity: 0,
    total_net_sales: "0",
    known_hour_quantity: 0,
    unknown_hour_quantity: 0,
    hourly_buckets: [],
    menu_rankings: [],
  };

  function render(
    menus: MenuItem[] | null,
    search = "",
    costData: CostSimulationResponse | null = emptyCostData,
    salesData: SalesAnalyticsResponse | null = emptySalesData,
  ) {
    const params = new URLSearchParams(search);
    const statusParam = params.get("status") ?? "all";
    const apiStatus = statusParam === "needs_check" ? "all" : statusParam;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    clients.push(client);
    if (menus !== null) {
      client.setQueryData(
        ["menus", store.id, params.get("q") ?? "", params.get("category") ?? "", apiStatus],
        menus,
      );
      client.setQueryData(["menus", store.id, "", "", "all"], menus);
      client.setQueryData(
        ["menus", store.id, "active-count"],
        menus.filter((item) => item.is_active),
      );
      client.setQueryData(
        ["menu-categories", store.id],
        [{ id: "food", name: "식사", menu_count: menus.length }],
      );
    }
    if (costData) client.setQueryData(["menu-costs", store.id], costData);
    if (salesData) client.setQueryData(["analytics-sales", store.id], salesData);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/menus${search}`]}>
          <MenuManagementPage store={store} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return html;
  }

  it("3장 KPI 카드·공헌이익 안내 툴팁·전체 보기 버튼·상태 알약 탭·유형 필터·검색·메뉴 추가·페이지 탐색을 표시한다", () => {
    const html = render([menu(1)]);
    expect(html).not.toContain('data-testid="menu-category-cards"');
    expect(html).toContain("메뉴 공헌이익");
    expect(html).toContain('aria-label="메뉴 공헌이익 안내"');
    expect(html).toContain("판매 데이터 전체 기간");
    expect(html).toContain("전체 보기 →");
    expect(html).toContain("원가율");
    expect(html).toContain("확인 필요");
    expect(html).toContain('aria-label="유형 필터"');
    expect(html).toContain("메뉴 이름 검색");
    expect(html).toContain('aria-label="판매 상태"');
    expect(html).toContain('<th class="c">레시피</th>');
    expect(html).toContain('<th class="c">운영</th>');
    expect(html.match(/\+ 메뉴 추가/g)).toHaveLength(1);
    expect(html.indexOf("menu-table-region")).toBeLessThan(
      html.indexOf('aria-label="메뉴 목록 페이지"'),
    );
    expect(html).toContain('aria-label="검증 메뉴 1 메뉴 작업"');
  });

  it("데이터 로딩 중에는 미산출·대시 텍스트 대신 스켈레톤을 표시한다", () => {
    const html = render(null, "", null, null);
    expect(html).toContain('data-skeleton="true"');
    expect(html).toContain('aria-label="메뉴 목록 불러오는 중"');
    expect(html).not.toContain("미산출");
    expect(html).not.toContain("판매 데이터 없음");
    expect(html).not.toContain("확인할 항목 없음");
  });

  it("확인 필요 세부 조건(check 파라미터)으로 목록을 필터링하고 0건일 때 확인할 항목 없음을 표시한다", () => {
    const m1 = { ...menu(1), name: "완료메뉴", recipe_status: "COMPLETE" as const };
    const m2 = { ...menu(2), name: "미등록메뉴", recipe_status: "UNREGISTERED" as const };
    const filteredHtml = render([m1, m2], "?status=needs_check&check=unregistered_recipe");
    expect(filteredHtml).toContain("미등록메뉴");
    expect(filteredHtml).not.toContain("<td>완료메뉴</td>");
    expect(filteredHtml).toContain('aria-label="레시피 미등록 필터 해제"');

    const cleanHtml = render([m1]);
    expect(cleanHtml).toContain("확인할 항목 없음");
  });

  it("모든 레시피 상태를 메뉴명이 포함된 공통 칩 버튼으로 노출한다", () => {
    const html = render([
      { ...menu(1), recipe_status: "COMPLETE", recipe_item_count: 3 },
      { ...menu(2), recipe_status: "PARTIAL" },
      menu(3),
    ]);
    expect(html).toMatch(/<button[^>]*chip-ok[^>]*aria-label="검증 메뉴 1 레시피 등록완료 보기"/);
    expect(html).toMatch(/<button[^>]*chip-warn[^>]*aria-label="검증 메뉴 2 레시피 등록중 보기"/);
    expect(html).toMatch(/<button[^>]*chip-warn[^>]*aria-label="검증 메뉴 3 레시피 미등록 보기"/);
  });

  it("빈 결과에서도 목록 틀과 유형 필터 해제·페이지 하단을 유지한다", () => {
    const html = render([], "?q=없는메뉴&category=식사&status=active");
    expect(html).toContain("조건에 맞는 메뉴가 없습니다.");
    expect(html).toContain("menu-table-region");
    expect(html).toContain('aria-label="메뉴 목록 페이지"');
    expect(html).toContain('aria-label="식사 필터 해제"');
  });

  it("운영 전환은 저장과 재조회가 끝나야 완료를 알린다", async () => {
    let complete!: (updated: MenuItem) => void;
    let finishRefresh!: () => void;
    const refreshing = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    vi.mocked(updateMenu).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render([menu(1)]);
    const invalidate = vi.spyOn(clients[0], "invalidateQueries").mockReturnValueOnce(refreshing);
    const action = controls.switches[0].changeAction;
    expect(action).toBeTypeOf("function");
    const saving = action!(false, {} as never);
    await vi.waitFor(() =>
      expect(updateMenu).toHaveBeenCalledWith(store.id, "menu-1", { is_active: false }),
    );
    expect(controls.toast).not.toHaveBeenCalled();
    complete({ ...menu(1), is_active: false });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(controls.toast).not.toHaveBeenCalled();
    finishRefresh();
    await saving;
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["menus", store.id] });
    expect(controls.toast).toHaveBeenCalledWith({
      body: "'검증 메뉴 1' 출시대기으로 저장했습니다.",
      type: "info",
    });
  });

  it("저장 실패를 Switch에 전달해 복구하게 하고 오류를 알린다", async () => {
    vi.mocked(updateMenu).mockRejectedValueOnce(new Error("상태 저장 실패"));
    render([menu(1)]);
    const saving = controls.switches[0].changeAction!(false, {} as never);
    await expect(saving).rejects.toThrow("상태 저장 실패");
    expect(controls.toast).toHaveBeenCalledWith({ body: "상태 저장 실패", type: "error" });
    expect(
      clients[0].getQueryData<MenuItem[]>(["menus", store.id, "", "", "all"])?.[0].is_active,
    ).toBe(true);
  });
});
