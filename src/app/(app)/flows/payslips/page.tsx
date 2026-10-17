"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Salary slips now live inside Attendance (tab "Salary slip"). Old links and bookmarks land there. */
export default function PayslipsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/flows/attendance?tab=salary"); }, [router]);
  return null;
}
