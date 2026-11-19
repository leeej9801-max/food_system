import { describe, expect, it } from "vitest";
import type { Shift, WorkSession } from "../api/attendance";
import {
  ATTENDANCE_GRACE_MINUTES,
  addDays,
  analyzeDayTimeline,
  buildDayScheduleRows,
  computeTodayStatusCounts,
  isClosed,
  monthGrid,
  navigatePeriod,
  overtimeMinutes,
  periodFor,
  resizedTime,
  sessionsForDay,
  shortDateRange,
  storeDay,
  timeRange,
  timelineAxis,
  timelinePointPct,
  timelineSpanStyle,
  zonedInputToIso,
  type SessionInterval,
} from "./attendance";

const shift = (id: string, start_minute: number, end_minute: number, staff_id: string | null = "s1", label = "오전 타임", work_date = "2026-11-18"): Shift => ({
  id,
  staff_id,
  work_date,
  start_minute,
  end_minute,
  label,
});

const interval = (
  id: string,
  startMinute: number,
  endMinute: number,
  opts: Partial<SessionInterval> = {},
): SessionInterval => ({
  id,
  staff_id: "s1",
  startMinute,
  endMinute,
  actualStartLabel: "09:00",
  actualEndLabel: "18:00",
  isLive: false,
  isMissing: false,
  ...opts,
});

describe("근태 기간과 시간", () => {
  it("선택일이 속한 월~일 주와 연도 경계를 계산한다", () => {
    expect(periodFor("2026-11-25", "week")).toEqual({ start: "2026-11-23", end: "2026-11-29" });
    expect(periodFor("2027-01-01", "week")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(navigatePeriod("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("월간 실제 요일·윤년·휴무를 사용한다", () => {
    const days = monthGrid("2026-11-17");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-10-26");
    expect(periodFor("2028-02-12", "month").end).toBe("2028-02-29");
    expect(isClosed("2026-11-22", "월,화,수,목,금")).toBe(true);
    expect(isClosed("2026-11-22", "연중무휴")).toBe(false);
  });
  it("드래그를 30분으로 맞추고 1시간·0~24시 범위를 지킨다", () => {
    expect(resizedTime(600, 720, "start", 90)).toEqual({ start_minute: 660, end_minute: 720 });
    expect(resizedTime(600, 720, "end", -1000)).toEqual({ start_minute: 600, end_minute: 660 });
    expect(resizedTime(600, 720, "start", -1000).start_minute).toBe(0);
    expect(resizedTime(600, 720, "end", 1000).end_minute).toBe(1440);
    expect(resizedTime(600, 720, "end", 16).end_minute).toBe(750);
  });
  it("브라우저 시간대와 무관하게 매장 일시를 UTC로 변환한다", () => {
    expect(zonedInputToIso("2026-11-17T09:30", "Asia/Seoul")).toBe("2026-11-17T00:30:00.000Z");
    expect(zonedInputToIso("2026-11-17T09:30", "America/New_York")).toBe("2026-11-17T14:30:00.000Z");
    expect(storeDay("2026-11-16T16:00:00Z", "Asia/Seoul")).toBe("2026-11-17");
    expect(() => zonedInputToIso("2026-03-08T02:30", "America/New_York")).toThrow();
  });
  it("초과근무와 날짜·시간 범위 표기를 계산한다", () => {
    expect(timeRange("13:30", "18:30")).toBe("13:30 ~ 18:30");
    expect(shortDateRange("2026-11-17", "2026-11-17")).toBe("11.17");
    expect(shortDateRange("2026-11-16", "2026-11-22")).toBe("11.16 ~ 11.22");
    expect(overtimeMinutes(636, 1530)).toBe(0);
    expect(overtimeMinutes(600, 600)).toBe(0);
    expect(overtimeMinutes(636, 450)).toBe(186);
  });
});

describe("일간 타임라인 상태 판정 (유예 5분)", () => {
  it("판단 유예 상수는 5분이며 5분 이내 차이는 정시로 본다", () => {
    expect(ATTENDANCE_GRACE_MINUTES).toBe(5);
    const s = [shift("sh1", 540, 1080)]; // 09:00 ~ 18:00
    // 09:05 ~ 17:55 (지각/조기퇴근 각 5분)
    const withinLateEarly = analyzeDayTimeline(s, [interval("a1", 545, 1075)]);
    expect(withinLateEarly.gaps).toEqual([]);
    expect(withinLateEarly.totalLateMinutes).toBe(0);
    expect(withinLateEarly.totalEarlyLeaveMinutes).toBe(0);
    expect(withinLateEarly.bars[0].segments).toEqual([{ kind: "normal", startMinute: 545, endMinute: 1075 }]);

    // 08:55 ~ 18:05 (조기출근/연장 각 5분)
    const withinOver = analyzeDayTimeline(s, [interval("a2", 535, 1085)]);
    expect(withinOver.gaps).toEqual([]);
    expect(withinOver.totalOvertimeMinutes).toBe(0);
    expect(withinOver.bars[0].segments).toEqual([{ kind: "normal", startMinute: 535, endMinute: 1085 }]);
  });

  it("6분 이상 차이는 지각·조기퇴근·초과(전/후)로 분리된다", () => {
    const s = [shift("sh1", 540, 1080)];
    // 6분 지각 + 6분 조기퇴근
    const lateEarly = analyzeDayTimeline(s, [interval("a1", 546, 1074)]);
    expect(lateEarly.gaps).toEqual([
      { kind: "late", startMinute: 540, endMinute: 546, minutes: 6 },
      { kind: "earlyLeave", startMinute: 1074, endMinute: 1080, minutes: 6 },
    ]);
    expect(lateEarly.totalLateMinutes).toBe(6);
    expect(lateEarly.totalEarlyLeaveMinutes).toBe(6);

    // 조기 출근 20분 + 계획 후 초과 30분
    const over = analyzeDayTimeline(s, [interval("a2", 520, 1110)]);
    expect(over.gaps).toEqual([]);
    expect(over.totalOvertimeMinutes).toBe(50);
    expect(over.bars[0].segments).toEqual([
      { kind: "overtime", startMinute: 520, endMinute: 540 },
      { kind: "normal", startMinute: 540, endMinute: 1080 },
      { kind: "overtime", startMinute: 1080, endMinute: 1110 },
    ]);

    // 지각 20분 + 계획 후 초과 40분
    const lateAndOver = analyzeDayTimeline(s, [interval("a3", 560, 1120)]);
    expect(lateAndOver.gaps).toEqual([{ kind: "late", startMinute: 540, endMinute: 560, minutes: 20 }]);
    expect(lateAndOver.bars[0].segments).toEqual([
      { kind: "normal", startMinute: 560, endMinute: 1080 },
      { kind: "overtime", startMinute: 1080, endMinute: 1120 },
    ]);
  });

  it("계획 없는 실제 근무는 전부 무계획(주황)으로 처리한다", () => {
    const res = analyzeDayTimeline([], [interval("u1", 720, 960)]);
    expect(res.hasUnplanned).toBe(true);
    expect(res.gaps).toEqual([]);
    expect(res.bars[0].isUnplanned).toBe(true);
    expect(res.bars[0].segments).toEqual([{ kind: "unplanned", startMinute: 720, endMinute: 960 }]);
  });

  it("근무 중(퇴근 전)은 조기퇴근을 잡지 않고, 계획 끝을 넘기면 초과 구간을 이어 붙인다", () => {
    const s = [shift("sh1", 600, 900)]; // 10:00 ~ 15:00
    const liveInShift = analyzeDayTimeline(s, [interval("l1", 615, 780, { isLive: true })]);
    expect(liveInShift.gaps).toEqual([{ kind: "late", startMinute: 600, endMinute: 615, minutes: 15 }]);
    expect(liveInShift.totalEarlyLeaveMinutes).toBe(0);
    expect(liveInShift.bars[0].isLive).toBe(true);

    const liveOvertime = analyzeDayTimeline(s, [interval("l2", 600, 940, { isLive: true })]);
    expect(liveOvertime.gaps).toEqual([]);
    expect(liveOvertime.bars[0].segments).toEqual([
      { kind: "normal", startMinute: 600, endMinute: 900 },
      { kind: "overtime", startMinute: 900, endMinute: 940 },
    ]);
  });

  it("퇴근 누락 세션은 시작일자에만 표시되고 조기퇴근으로 오판하지 않는다", () => {
    const raw: WorkSession[] = [
      {
        staff_id: "s1",
        in_id: "i1",
        out_id: null,
        in_event_id: "e1",
        out_event_id: null,
        started_at: "2026-11-17T01:20:00Z", // KST 10:20
        ended_at: null,
        minutes: null,
        missing: true,
      },
    ];
    const s = [shift("sh1", 600, 900, "s1", "오전 타임", "2026-11-17")];
    const onDay = sessionsForDay(raw, s, "2026-11-17", "Asia/Seoul", "2026-11-18T05:00:00Z");
    expect(onDay).toHaveLength(1);
    expect(onDay[0].startMinute).toBe(620);
    expect(onDay[0].endMinute).toBe(900);

    const nextDay = sessionsForDay(raw, [], "2026-11-18", "Asia/Seoul", "2026-11-18T05:00:00Z");
    expect(nextDay).toHaveLength(0);

    const analysis = analyzeDayTimeline(s, onDay);
    expect(analysis.gaps).toEqual([{ kind: "late", startMinute: 600, endMinute: 620, minutes: 20 }]);
    expect(analysis.bars[0].segments).toEqual([{ kind: "missing", startMinute: 620, endMinute: 900 }]);
  });

  it("월간 일자 상세 모달 행 데이터에서 상태를 정확히 판정한다", () => {
    const shifts: Shift[] = [
      shift("sh1", 540, 840, "s1", "오전 타임", "2026-11-18"), // 09:00 ~ 14:00 (지각+초과)
      shift("sh2", 900, 1260, "s2", "오후 타임", "2026-11-18"), // 15:00 ~ 21:00 (출근 예정)
      shift("sh3", 600, 900, null, "점주 근무", "2026-11-18"),
    ];
    const sessions: WorkSession[] = [
      {
        staff_id: "s1",
        in_id: "i1",
        out_id: "o1",
        in_event_id: "e1",
        out_event_id: "e2",
        started_at: "2026-11-18T00:20:00Z", // 09:20 KST
        ended_at: "2026-11-18T05:30:00Z", // 14:30 KST
        minutes: 310,
        missing: false,
      },
      {
        staff_id: "s3",
        in_id: "i2",
        out_id: "o2",
        in_event_id: "e3",
        out_event_id: "e4",
        started_at: "2026-11-18T09:00:00Z", // 18:00 KST
        ended_at: "2026-11-18T12:00:00Z", // 21:00 KST
        minutes: 180,
        missing: false,
      },
    ];
    const rows = buildDayScheduleRows({
      day: "2026-11-18",
      today: "2026-11-18",
      currentMinute: 870, // 14:30
      timezone: "Asia/Seoul",
      nowIso: "2026-11-18T05:30:00Z",
      shifts,
      sessions,
    });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ staffId: "s1", status: "지각", statusDetail: "지각 20분 · 초과 30분" });
    expect(rows[1]).toMatchObject({ staffId: null, status: "점주 근무" });
    expect(rows[2]).toMatchObject({ staffId: "s2", status: "출근 예정" });
    expect(rows[3]).toMatchObject({ staffId: "s3", typeLabel: "무계획 근무", status: "무계획" });
  });

  it("계획 시작 + 유예(5분) 경과 후 출근(IN) 기록이 없으면 타임라인·오늘 현황·상세 행 모두 지각으로 표시한다", () => {
    // 13:30 (810분) ~ 20:00 (1200분), 현재 14:37 (877분), 미출근(IN 없음)
    const plannedShift = shift("sh-late", 810, 1200, "s1", "오후 타임", "2026-11-18");
    const currentMinute = 14 * 60 + 37; // 877

    // 유예 5분 이내(13:35 = 815분)에는 지각이 아니라 출근 예정
    const withinGrace = analyzeDayTimeline([plannedShift], [], ATTENDANCE_GRACE_MINUTES, 815);
    expect(withinGrace.gaps).toEqual([]);
    expect(withinGrace.totalLateMinutes).toBe(0);

    // 14:37 (877분)에는 67분 지각 갭 생성
    const analysis = analyzeDayTimeline([plannedShift], [], ATTENDANCE_GRACE_MINUTES, currentMinute);
    expect(analysis.gaps).toEqual([
      { kind: "late", startMinute: 810, endMinute: 877, minutes: 67 },
    ]);
    expect(analysis.totalLateMinutes).toBe(67);

    // 오늘 현황 카운트: EXPECTED 대신 LATE로 집계
    const counts = computeTodayStatusCounts({
      summary: [
        { staff_id: "s1", status: "EXPECTED" },
        { staff_id: "s2", status: "EXPECTED" },
      ],
      shifts: [
        plannedShift,
        shift("sh-future", 960, 1260, "s2", "저녁 타임", "2026-11-18"), // 16:00~21:00 -> 아직 출근 예정
      ],
      sessions: [],
      day: "2026-11-18",
      today: "2026-11-18",
      currentMinute,
      timezone: "Asia/Seoul",
      nowIso: "2026-11-18T05:37:00Z",
    });
    expect(counts.LATE).toBe(1);
    expect(counts.EXPECTED).toBe(1);

    // 상세 모달 행에서도 지각 상태 표시
    const rows = buildDayScheduleRows({
      day: "2026-11-18",
      today: "2026-11-18",
      currentMinute,
      timezone: "Asia/Seoul",
      nowIso: "2026-11-18T05:37:00Z",
      shifts: [plannedShift],
      sessions: [],
    });
    expect(rows[0]).toMatchObject({
      staffId: "s1",
      status: "지각",
      statusDetail: "지각 67분 · 미출근",
      tone: "danger",
    });
  });

  it("매장 영업시간(opening_hours) 기준으로 타임라인 축을 계산하고 미설정·자정 넘김은 0~24시로 폴백한다", () => {
    const axis = timelineAxis("11:00-22:00");
    expect(axis.startMinute).toBe(600); // 10:00 (1h pad)
    expect(axis.endMinute).toBe(1380); // 23:00 (1h pad)
    expect(timelinePointPct(600, axis)).toBeCloseTo(0);
    expect(timelinePointPct(1380, axis)).toBeCloseTo(100);
    expect(timelineSpanStyle(660, 1320, axis)).toEqual({
      left: `${((660 - 600) / 780) * 100}%`,
      width: `${((1320 - 660) / 780) * 100}%`,
    });

    const fallback = timelineAxis(null);
    expect(fallback.startMinute).toBe(0);
    expect(fallback.endMinute).toBe(1440);

    const invalid = timelineAxis("invalid");
    expect(invalid.startMinute).toBe(0);
    expect(invalid.endMinute).toBe(1440);

    const pastMidnight = timelineAxis("17:00-01:00");
    expect(pastMidnight.closePastMidnight).toBe(true);
    expect(pastMidnight.startMinute).toBe(0);
    expect(pastMidnight.endMinute).toBe(1440);
  });
});