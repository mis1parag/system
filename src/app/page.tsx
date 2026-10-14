import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";

export default async function Home() {
  const s = await getSession();
  redirect(!s ? "/login" : "/flows/panel");
}
