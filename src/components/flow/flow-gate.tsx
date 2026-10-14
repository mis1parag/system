"use client";

import type { ReactNode } from "react";
import { ErrorBox, PageLoading } from "@/components/common";
import { useFlows } from "@/lib/flow-store";

/** Shows a loader / error until the FMS data has arrived. Must sit inside <FlowProvider>. */
export function Gate({ children }: { children: ReactNode }) {
  const { data, loading, error, refresh } = useFlows();
  if (loading) return <PageLoading />;
  if (error && !data) return <ErrorBox message={error} onRetry={refresh} />;
  return <>{children}</>;
}
