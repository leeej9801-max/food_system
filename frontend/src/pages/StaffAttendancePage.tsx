import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "../api/client";
import { fetchStaffMe, logoutStaff, recordStaffQR, startStaffLogin, type RecordedAttendance, type StaffMe } from "../api/staffAccess";
import { clearStaffLink, readStaffLink } from "../lib/staffLink";
import "../styles/staff-access.css";

export function StaffAttendancePage() {
  const [context] = useState(readStaffLink);
  const [me, setMe] = useState<StaffMe | null>(null);
  const [done, setDone] = useState<RecordedAttendance | null>(null);
  const [error, setError] = useState(() => new URLSearchParams(location.search).has("error") ? "카카오 로그인을 완료하지 못했습니다. 초대 링크나 매장 QR에서 다시 시작해 주세요." : "");
  const [loading, setLoading] = useState(!!context);
  const [loginBusy, setLoginBusy] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!context || started.current) return;
    started.current = true;
    async function run() {
      try {
        const person = await fetchStaffMe(context!.store);
        setMe(person);
        if (person.status === "ACTIVE" && context!.qr) {
          const record = await recordStaffQR(context!.store, context!.qr, context!.clientEvent);
          setDone(record); clearStaffLink();
        } else if (person.status === "PENDING") clearStaffLink();
      } catch (err) {
        if (!(err instanceof ApiClientError) || err.status !== 401) setError((err as Error).message);
      } finally { setLoading(false); }
    }
    void run();
  }, [context]);

  async function login() {
    if (!context) return;
    setError(""); setLoginBusy(true);
    try { const result = await startStaffLogin(context.store, context.invite); location.assign(result.authorize_url); }
    catch (err) { setError((err as Error).message); setLoginBusy(false); }
  }
  const label = done?.kind === "OUT" ? "퇴근" : "출근";
  return <main className="staff-mobile"><header><strong>음식점 AX</strong><span>직원 출퇴근</span></header>
    <section className="staff-mobile-content" aria-busy={loading}>
      {done ? <><div className="staff-success-mark" aria-hidden="true">✓</div><p className="staff-eyebrow">등록 완료</p><h1>{done.name} 님<br />{label} 확인되었습니다</h1><p>서버 시각으로 안전하게 기록했습니다.</p><time dateTime={done.occurred_at}>{new Date(done.occurred_at).toLocaleString("ko-KR")}</time><p className="staff-help">다음 출퇴근 때 매장 QR을 다시 스캔해 주세요.</p></>
        : loading ? <><h1>직원 정보를<br />확인하고 있습니다</h1><p role="status">잠시만 기다려 주세요.</p></>
        : !context ? <><h1>매장 QR을<br />스캔해 주세요</h1><p>직원 등록은 점주에게 받은 초대 링크에서 시작합니다.</p></>
        : me?.status === "PENDING" ? <><p className="staff-eyebrow">직원 연결 요청 완료</p><h1>{me.name} 님<br />점주 승인을 기다려 주세요</h1><p>승인을 받은 뒤 매장 QR을 스캔하면 출퇴근이 등록됩니다.</p><button className="staff-primary" onClick={() => location.assign(`${location.pathname}?${new URLSearchParams({ store: context.store })}`)}>승인 상태 확인</button></>
        : me ? <><h1>{me.name} 님<br />매장 QR을 스캔해 주세요</h1><p>현재 근무 상태에 따라 출근 또는 퇴근을 기록합니다.</p></>
        : <><p className="staff-eyebrow">{context.invite ? "직원 초대" : "매장 QR 확인"}</p><h1>{context.invite ? <>내 카카오 계정으로<br />직원 연결하기</> : <>카카오 로그인 후<br />출퇴근을 등록합니다</>}</h1><p>{context.invite ? "카카오 계정을 연결하고 점주 승인을 받으면 출퇴근을 기록할 수 있습니다." : "내 계정으로 로그인하면 현재 근무 상태에 따라 자동으로 기록됩니다."}</p><button className="staff-kakao" disabled={loginBusy} onClick={() => void login()}>{loginBusy ? "로그인 연결 중…" : "카카오 로그인"}</button><p className="staff-help">카카오 회원번호와 닉네임만 저장합니다.<br />이메일·전화번호·프로필 사진은 수집하지 않습니다.</p></>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {me && <button className="staff-text-button" onClick={async () => { try { await logoutStaff(context!.store); clearStaffLink(); setMe(null); setDone(null); } catch (err) { setError((err as Error).message); } }}>이 기기에서 로그아웃</button>}
    </section><footer>매장에 표시된 QR은 30초마다 바뀝니다.<br />로그인 중 만료되면 새 QR을 다시 스캔해 주세요.</footer>
  </main>;
}
