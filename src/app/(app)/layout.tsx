import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { AppShell } from "@/components/app-shell";
import { FlowProvider } from "@/lib/flow-store";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <FlowProvider>
      <AppShell user={{ userId: session.userId, name: session.name, role: session.role }}>{children}</AppShell>
    </FlowProvider>
  );
}
