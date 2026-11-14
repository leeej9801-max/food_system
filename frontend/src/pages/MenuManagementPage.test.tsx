import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Switch } from "@astryxdesign/core/Switch";
import { getMenuPage, MenuManagementPage } from "./MenuManagementPage";
import { updateMenu } from "../api/menus";
import type { MenuItem, Store } from "../types";

const controls = vi.hoisted(() => ({ switches: [] as ComponentProps<typeof Switch>[], toast: vi.fn() }));

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
  ...await importOriginal<typeof import("@astryxdesign/core/Toast")>(),
  useToast: () => controls.toast,
}));
vi.mock("../api/menus", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/menus")>(),
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
    expect(second.rows.map((row) => row.no)).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
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

describe("메뉴 관리 화면", () => {
  const store: Store = {
    id: "test-store", name: "검증 매장", timezone: "Asia/Seoul",
    business_days: null, opening_hours: null, floor_fixtures: [],
    created_at: "2026-11-15T00:00:00Z", updated_at: "2026-11-15T00:00:00Z",
  };

  function render(menus: MenuItem[], search = "") {
    const params = new URLSearchParams(search);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    clients.push(client);
    client.setQueryData(["menus", store.id, params.get("q") ?? "", params.get("category") ?? "", params.get("status") ?? "all"], menus);
    client.setQueryData(["menus", store.id, "active-count"], menus.filter((item) => item.is_active));
    client.setQueryData(["menu-categories", store.id], [{ id: "food", name: "식사", menu_count: menus.length }]);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/menus${search}`]}>
          <MenuManagementPage store={store} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return html;
  }

  it("전체 요약·유형 추가·검색·상태 필터·메뉴 추가·페이지 탐색을 유지한다", () => {
    const html = render([menu(1)]);
    expect(html).toContain('aria-label="전체 1개, 선택됨"');
    expect(html).toContain('aria-label="유형 추가"');
    expect(html).toContain("메뉴 이름 검색");
    expect(html).toContain("판매 상태");
    expect(html.match(/\+ 메뉴 추가/g)).toHaveLength(1);
    expect(html.indexOf("menu-table-region")).toBeLessThan(html.indexOf('aria-label="메뉴 목록 페이지"'));
    expect(html).toContain('aria-label="검증 메뉴 1 메뉴 작업"');
  });

  it("모든 레시피 상태를 메뉴명이 포함된 칩 버튼으로 노출한다", () => {
    const html = render([
      { ...menu(1), recipe_status: "COMPLETE", recipe_item_count: 3 },
      { ...menu(2), recipe_status: "PARTIAL" },
      menu(3),
    ]);
    expect(html).toMatch(/<button[^>]*chip-ok[^>]*aria-label="검증 메뉴 1 레시피 등록완료 \+3 보기"/);
    expect(html).toMatch(/<button[^>]*chip-warn[^>]*aria-label="검증 메뉴 2 레시피 등록중 보기"/);
    expect(html).toMatch(/<button[^>]*chip-idle[^>]*aria-label="검증 메뉴 3 레시피 미등록 보기"/);
    expect(html).not.toMatch(/>보기<\/button>/);
  });

  it("빈 결과에서도 목록 틀과 페이지 하단을 유지한다", () => {
    const html = render([], "?q=없는메뉴&category=식사&status=active");
    expect(html).toContain("조건에 맞는 메뉴가 없습니다.");
    expect(html).toContain("menu-table-region");
    expect(html).toContain('aria-label="메뉴 목록 페이지"');
    expect(html).toContain('aria-label="식사 0개, 선택됨"');
  });

  it("운영 전환은 저장과 재조회가 끝나야 완료를 알린다", async () => {
    let complete!: (updated: MenuItem) => void;
    let finishRefresh!: () => void;
    const refreshing = new Promise<void>((resolve) => { finishRefresh = resolve; });
    vi.mocked(updateMenu).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render([menu(1)]);
    const invalidate = vi.spyOn(clients[0], "invalidateQueries").mockReturnValueOnce(refreshing);
    const action = controls.switches[0].changeAction;
    expect(action).toBeTypeOf("function");
    // 두 번째 인자는 입력 이벤트이며, 이 콜백은 상태값만 사용한다.
    const saving = action!(false, {} as never);
    await vi.waitFor(() => expect(updateMenu).toHaveBeenCalledWith(store.id, "menu-1", { is_active: false }));
    expect(controls.toast).not.toHaveBeenCalled();
    complete({ ...menu(1), is_active: false });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(controls.toast).not.toHaveBeenCalled();
    finishRefresh();
    await saving;
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["menus", store.id] });
    expect(controls.toast).toHaveBeenCalledWith({ body: "'검증 메뉴 1' 출시대기으로 저장했습니다.", type: "info" });
  });

  it("저장 실패를 Switch에 전달해 복구하게 하고 오류를 알린다", async () => {
    vi.mocked(updateMenu).mockRejectedValueOnce(new Error("상태 저장 실패"));
    render([menu(1)]);
    const saving = controls.switches[0].changeAction!(false, {} as never);
    await expect(saving).rejects.toThrow("상태 저장 실패");
    expect(controls.toast).toHaveBeenCalledWith({ body: "상태 저장 실패", type: "error" });
    expect(clients[0].getQueryData<MenuItem[]>(["menus", store.id, "", "", "all"])?.[0].is_active).toBe(true);
  });
});
