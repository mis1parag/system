"use client";

import { useMemo } from "react";
import { attSettings, calFrom, personDays, personReport, teamReport, type PersonReport } from "@/lib/attendance";
import { useFlows } from "@/lib/flow-store";

/** Attendance numbers for any date range, worked out from the punches, leaves and holidays already loaded. */
export function useAttendance() {
  const { data, now } = useFlows();
  const set = useMemo(() => attSettings(data?.settings), [data?.settings]);
  const cal = useMemo(() => calFrom(data?.settings, data?.holidays), [data?.settings, data?.holidays]);
  const rows = useMemo(() => data?.attendance ?? [], [data?.attendance]);
  const leaves = useMemo(() => data?.leaves ?? [], [data?.leaves]);
  const n = now();
  return useMemo(() => ({
    set, cal, rows, leaves, nowDT: n,
    days: (userId: string, from: string, to: string) => personDays(rows, leaves, userId, from, to, n, cal, set),
    person: (userId: string, from: string, to: string): PersonReport => personReport(userId, personDays(rows, leaves, userId, from, to, n, cal, set), set),
    team: (userIds: string[], from: string, to: string) => teamReport(userIds, rows, leaves, from, to, n, cal, set),
  }), [set, cal, rows, leaves, n]);
}
