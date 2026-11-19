import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@astryxdesign/core/Button";
import { approveStaff, fetchStaffIdentities, inviteStaff } from "../api/staffAccess";
import "../styles/staff-access.css";

export function StaffAccessManager({ storeId }: { storeId: string }) {
  const query = useQuery({ queryKey: ["staff-identities", storeId], queryFn: () => fetchStaffIdentities(storeId), refetchInterval: 3000 });
  const [invite, setInvite] = useState<{ name: string; url: string } | null>(null);
  const [message, setMessage] = useState("");
  const mutation = useMutation({ mutationFn: async ({ id, name, approve }: { id: string; name: string; approve: boolean }) => {
    setMessage("");
    if (approve) { await approveStaff(storeId, id); setMessage(`${name} 님을 승인했습니다.`); }
    else { const result = await inviteStaff(storeId, id); setInvite({ name, url: result.url }); }
    await query.refetch();
  } });
  return <section className="attendance-access"><h3>직원 카카오 연결</h3><p className="note">PROVISIONAL · 공개 데모에서는 점주 권한을 확인하지 않습니다.</p>
    {query.isPending && <p role="status">직원을 확인하는 중입니다…</p>}
    {query.data?.map((person) => <div className="access-person" key={person.staff_id}><div><strong>{person.name}</strong><small>{person.status === "ACTIVE" ? "승인 완료" : person.status === "PENDING" ? `${person.nickname} · 승인 대기` : "카카오 미연결"}</small></div>{person.status !== "ACTIVE" && <Button label={person.status === "PENDING" ? "승인" : "초대 링크"} isDisabled={mutation.isPending} onClick={() => mutation.mutate({ id: person.staff_id, name: person.name, approve: person.status === "PENDING" })} />}</div>)}
    {invite && <div><label className="field">{invite.name} 님 초대 링크<input className="access-link" readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} /></label><small>한 번만 사용 가능 · 7일 후 만료 · 새로 만들면 이전 링크는 만료됩니다.</small><Button label="링크 복사" clickAction={async () => { try { await navigator.clipboard.writeText(invite.url); setMessage("초대 링크를 복사했습니다."); } catch { setMessage("위 링크를 선택해 직접 복사해 주세요."); } }} /></div>}
    {message && <p role="status">{message}</p>}{(mutation.error || query.error) && <p role="alert" className="error">{(mutation.error || query.error)?.message}</p>}
  </section>;
}
