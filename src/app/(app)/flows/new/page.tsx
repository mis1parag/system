"use client";

import { FlowBuilder } from "@/components/flow/flow-builder";
import { useRequireCap } from "@/lib/flow-store";

export default function NewFlowPage() {
  const ok = useRequireCap("createFms");
  return ok ? <FlowBuilder /> : null;
}
