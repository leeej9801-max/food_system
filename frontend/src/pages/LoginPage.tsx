import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { AppLink } from "../components/AppLink";
import { startOwnerKakaoLogin, useOwnerMe } from "../api/ownerAuth";

const VISUAL_CHIPS = ["매출·원가", "재고·입고", "근태·손익"] as const;

// 콜백 실패 시 백엔드가 /login?error=CODE 로 돌려보낸다.
const ERROR_MESSAGES: Record<string, string> = {
  KAKAO_CANCELLED: "카카오 로그인이 취소되었습니다. 다시 시도해 주세요.",
  OAUTH_STATE: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  OWNER_LOGIN_RETRY: "로그인을 다시 시도해 주세요.",
};

function callbackError(): string | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("error");
  return code === null ? null : (ERROR_MESSAGES[code] ?? "로그인에 실패했습니다. 다시 시도해 주세요.");
}

function LoginVisualPanel() {
  return (
    <aside className="login-background" aria-hidden="true">
      <div className="login-visual-content">
        <p className="login-visual-kicker">FOOD AX PLATFORM</p>
        <h2 className="login-visual-title">
          매장 운영을
          <br />
          하나로.
        </h2>
        <div className="login-visual-chip-list">
          {VISUAL_CHIPS.map((label) => (
            <div key={label} className="login-visual-chip">
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="login-visual-assets">
        <div className="data-flow-node node-1" />
        <div className="data-flow-node node-2" />
        <div className="data-flow-node node-3" />
        <div className="data-flow-node node-4" />
        <div className="login-visual-orb login-visual-orb-main" />
        <div className="login-visual-orb login-visual-orb-sub" />
      </div>
    </aside>
  );
}

export function LoginPage() {
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(callbackError);
  const owner = useOwnerMe();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function handleKakaoLogin() {
    setError(null);
    setLoading(true);
    try {
      const res = await startOwnerKakaoLogin();
      window.location.assign(res.authorize_url);
    } catch {
      setError("카카오 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setLoading(false);
    }
  }

  if (owner.data) return <Navigate to="/" replace />;

  return (
    <main className={`login-page ${isReady ? "is-ready" : "is-initializing"}`}>
      <div className="login-page-decor" aria-hidden="true">
        <div className="login-page-glow login-glow-1" />
        <div className="login-page-glow login-glow-2" />
        <div className="login-page-node node-bg-1" />
        <div className="login-page-node node-bg-2" />
        <div className="login-page-node node-bg-3" />
        <div className="login-page-node node-bg-4" />
        <div className="login-page-shape shape-circle-1" />
        <div className="login-page-shape shape-square-1" />
        <div className="login-page-line login-page-line-1" />
        <div className="login-page-line login-page-line-2" />
        <div className="login-page-line login-page-line-3" />
      </div>

      <div className="login-combined-card">
        <LoginVisualPanel />
        <section className="login-form-panel">
          <div className="login-card-viewport">
            <div className="login-card active">
              <div className="login-logo-mark">FOOD AX</div>
              <h1>점주 로그인</h1>

              <div className="social-button-group">
                <button
                  type="button"
                  className="social-login-button social-login-kakao"
                  disabled={loading}
                  onClick={() => void handleKakaoLogin()}
                >
                  <svg
                    className="social-button-icon"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 4C6.48 4 2 7.52 2 11.86c0 2.8 1.86 5.27 4.66 6.67-.15.54-.96 3.47-1 3.64 0 0-.02.17.09.24.11.06.24.01.24.01.32-.04 3.7-2.44 4.28-2.85.56.08 1.14.13 1.73.13 5.52 0 10-3.52 10-7.84C22 7.52 17.52 4 12 4z" />
                  </svg>
                  <span>{loading ? "연결 중" : "카카오로 시작하기"}</span>
                </button>

                <button
                  type="button"
                  className="social-login-button social-login-google"
                  disabled
                  aria-disabled="true"
                >
                  <svg
                    className="social-button-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 12h5a5 5 0 1 1-1.46-3.54" />
                  </svg>
                  <span>Google로 시작하기</span>
                  <span className="social-ready-badge">준비 중</span>
                </button>
              </div>

              {error && (
                <p className="login-error-box" role="alert">
                  {error}
                </p>
              )}

              <div className="login-links">
                <AppLink to="/home">매장 홈</AppLink>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
