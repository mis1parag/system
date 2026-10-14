"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/common";
import { FlowBuilder } from "@/components/flow/flow-builder";
import { useFlows, useRequireCap } from "@/lib/flow-store";

export default function EditFlowPage() {
  const { id } = useParams<{ id: string }>();
  const { flows } = useFlows();
  const ok = useRequireCap("createFms");
  const flow = flows.find((f) => f.flowId === id);
  if (!ok) return null;
  if (!flow) return <EmptyState title="FMS not found" action={<Link href="/flows" className={buttonVariants({ variant: "outline" })}>All FMS</Link>} />;
  return <FlowBuilder key={flow.rec.updatedAt} flow={flow} />;
}
