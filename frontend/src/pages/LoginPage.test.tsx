import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { startOwnerKakaoLogin, useOwnerMe } from "../api/ownerAuth";

type ElementProps = Record<string, unknown>;

const harness = vi.hoisted(() => ({
  cursor: 0,
  states: new Map<number, unknown>(),
  elements: [] as { type: string; props: ElementProps }[],
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: <T,>(initial: T | (() => T)) => {
    const index = harness.cursor++;
    if (!harness.states.has(index)) {
      harness.states.set(
        index,
        typeof initial === "function" ? (initial as () => T)() : initial,
      );
    }
    return [
      harness.states.get(index) as T,
      (next: SetStateAction<T>) => {
        harness.states.set(
          index,
          typeof next === "function"
            ? (next as (previous: T) => T)(harness.states.get(index) as T)
            : next,
        );
      },
    ];
  },
}));

vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: unknown, props: unknown) => {
    if (typeof type === "string") {
      harness.elements.push({ type, props: props as ElementProps });
    }
  };
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => {
      record(args[0], args[1]);
      return actual.jsx(...args);
    },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => {
      record(args[0], args[1]);
      return actual.jsxs(...args);
    },
  };
});

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      if (typeof args[0] === "string") {
        harness.elements.push({ type: args[0], props: args[1] as ElementProps });
      }
      return actual.jsxDEV(...args);
    },
  };
});

vi.mock("../components/AppLink", () => ({
  AppLink: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("../api/ownerAuth", () => ({
  startOwnerKakaoLogin: vi.fn(),
  useOwnerMe: vi.fn(() => ({ data: null })),
}));

vi.mock("react-router-dom", () => ({
  Navigate: ({ to }: { to: string }) => <a data-navigate={to} />,
}));

function render() {
  harness.cursor = 0;
  harness.elements.length = 0;
  return renderToStaticMarkup(<LoginPage />);
}

beforeEach(() => {
  harness.cursor = 0;
  harness.states.clear();
  harness.elements.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("점주 로그인 화면 (/login)", () => {
  it("소셜 로그인 버튼(카카오 활성, Google 준비 중 비활성)만 렌더링하고 비밀번호 입력란은 두지 않는다", () => {
    const html = render();
    expect(html).toContain("login-page");
    expect(html).toContain("점주 로그인");
    expect(html).toContain("카카오로 시작하기");
    expect(html).toContain("Google로 시작하기");
    expect(html).toContain("준비 중");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("<input");

    const googleButton = harness.elements.find(
      (entry) =>
        entry.type === "button" &&
        typeof entry.props.className === "string" &&
        entry.props.className.includes("social-login-google"),
    );
    expect(googleButton?.props.disabled).toBe(true);
  });

  it("카카오로 시작하기 클릭 시 GET /api/v1/auth/owner/kakao/start (PROVISIONAL)를 호출하고 실패 시 짧은 안내를 표시한다", async () => {
    vi.mocked(startOwnerKakaoLogin).mockRejectedValueOnce(new Error("404"));
    render();
    const kakaoButton = harness.elements.find(
      (entry) =>
        entry.type === "button" &&
        typeof entry.props.className === "string" &&
        entry.props.className.includes("social-login-kakao"),
    );
    expect(kakaoButton).toBeDefined();
    await (kakaoButton!.props.onClick as () => Promise<void>)();
    expect(startOwnerKakaoLogin).toHaveBeenCalledTimes(1);
    const html = render();
    expect(html).toContain("카카오 로그인을 시작하지 못했습니다");
  });

  it("콜백이 돌려준 ?error= 코드를 안내 문구로 보여 준다", () => {
    vi.stubGlobal("window", { location: { search: "?error=OAUTH_STATE" } });
    expect(render()).toContain("로그인 요청이 만료되었습니다");
  });

  it("이미 로그인한 점주는 / 로 보낸다", () => {
    vi.mocked(useOwnerMe).mockReturnValueOnce({
      data: { owner_id: "o", nickname: null, stores: [] },
    } as unknown as ReturnType<typeof useOwnerMe>);
    expect(render()).toContain('data-navigate="/"');
  });
});
