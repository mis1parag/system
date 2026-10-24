"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AwardIcon, BellIcon, BellRingIcon, WrenchIcon, CalendarCheck2Icon, CalendarDaysIcon, NotebookPenIcon, UsersRoundIcon, CalendarOffIcon, CheckCheckIcon, ClipboardCheckIcon, GaugeIcon, HelpCircleIcon, HistoryIcon, InboxIcon, LayoutDashboardIcon,
  KeyRoundIcon, LaptopIcon, ListChecksIcon, LockIcon, LogOutIcon, MenuIcon, ScanFaceIcon, SearchIcon, SettingsIcon, ShieldCheckIcon, SlidersHorizontalIcon, TrophyIcon, UserCogIcon, UsersIcon, WorkflowIcon, ZapIcon, type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { CheckInGate, CheckOutNudge, DayChip } from "@/components/attendance/checkin";
import { CommandPalette } from "@/components/command-palette";
import { Gate } from "@/components/flow/flow-gate";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFlows } from "@/lib/flow-store";
import { fmtDT } from "@/lib/dates";
import type { Action, ModuleId } from "@/lib/permissions";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem { href: string; label: string; short?: string; hint: string; icon: LucideIcon; /** shown only to people who have this module (and action) */ module?: ModuleId; action?: Action; /** shown when someone else is in reach of that module */ reach?: boolean; super?: boolean; badge?: "approvals" }

/** Which module (and action) a page needs. A person without it gets "no access" — and the server refuses the data anyway. */
function requirement(path: string): [ModuleId, Action] | "super" | null {
  const p = path.replace(/\/$/, "");
  const exact: Record<string, [ModuleId, Action] | "super"> = {
    "/flows/tasks": ["fms", "view"], "/flows/search": ["fms", "view"], "/flows/new": ["fms", "configure"], "/flows": ["fms", "view"],
    "/flows/checklist": ["checklist", "view"], "/flows/attendance": ["attendance", "view"], "/flows/team": ["attendance", "view"], "/flows/kiosk": ["attendance", "view"], "/flows/devices": ["attendance", "configure"],
    "/flows/scorecard": ["scorecard", "view"], "/flows/insights": ["reports", "view"], "/flows/vault": ["vault", "view"], "/flows/quick": ["quick_access", "view"],
    "/flows/users": ["employees", "view"], "/flows/holidays": ["attendance", "view"], "/flows/myteam": ["attendance", "view"], "/flows/reminders": ["reminders", "view"], "/flows/audit": ["audit", "view"], "/flows/settings": "super", "/flows/access": "super", "/flows/admin": "super", "/flows/console": "super",
  };
  if (exact[p]) return exact[p];
  if (/^\/flows\/[^/]+\/edit$/.test(p)) return ["fms", "configure"];
  if (/^\/flows\/(FLW|[A-Za-z]+-)/.test(p)) return ["fms", "view"];
  return null; // Home, help, my profile
}
interface NavGroup { title: string; items: NavItem[] }

/** Few groups, plain names. Each item has a one-line explanation (also shown in the quick search). */
const GROUPS: NavGroup[] = [
  {
    title: "",
    items: [
      { href: "/flows/panel", label: "Home", short: "Home", hint: "Today at a glance: what is late, what needs a decision", icon: LayoutDashboardIcon },
      { href: "/flows/kiosk", label: "Attendance kiosk", short: "Kiosk", hint: "Check in / out at the office kiosk (reception runs it; everyone can see their ID and today)", icon: ScanFaceIcon, module: "attendance" },
      { href: "/flows/leaderboard", label: "Leaderboard", short: "Leaders", hint: "This month: who came on time and finished their work", icon: AwardIcon },
      { href: "/flows/tasks", label: "FMS tasks", short: "FMS tasks", hint: "Steps of your FMS that are waiting for you", icon: ListChecksIcon, module: "fms" },
      { href: "/flows/checklist", label: "Checklist", short: "Checklist", hint: "Daily, weekly, monthly and one-time tasks — tick them off", icon: ClipboardCheckIcon, module: "checklist" },
      { href: "/flows/attendance", label: "Attendance", short: "Attendance", hint: "Check in and out, your month, apply for leave", icon: CalendarCheck2Icon, module: "attendance" },
      { href: "/flows/quick", label: "Quick access", short: "Quick", hint: "One-click shortcuts to the tools you use", icon: ZapIcon, module: "quick_access" },
      { href: "/flows/notes", label: "My notes", short: "Notes", hint: "Your private notepad — nobody else can see it", icon: NotebookPenIcon },
    ],
  },
  {
    title: "Processes",
    items: [
      { href: "/flows", label: "FMS", short: "FMS", hint: "Every process: PO dispatch, CRM orders, hiring… open one and start an entry", icon: WorkflowIcon, module: "fms" },
      { href: "/flows/approvals", label: "Approvals", hint: "Requests for more time — FMS steps and checklist tasks", icon: InboxIcon, badge: "approvals" },
    ],
  },
  {
    title: "Reports",
    items: [      { href: "/flows/scorecard", label: "Scorecard", short: "Scorecard", hint: "% work not done and not done on time, per person per week", icon: TrophyIcon, module: "scorecard" },
      { href: "/flows/insights", label: "Insights", hint: "Who delivers on time, which FMS runs late", icon: GaugeIcon, module: "reports" },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/flows/myteam", label: "My team", short: "Team", hint: "Attendance, work and leave of the people who report to you", icon: UsersRoundIcon, module: "attendance", reach: true },
      { href: "/flows/reminders", label: "Reminders", short: "Reminders", hint: "Reminders sent to you — and, for managers, to your team", icon: BellRingIcon, module: "reminders" },
      { href: "/flows/devices", label: "Laptops & camera", short: "Laptops", hint: "Which laptops people check in from, the camera rule, who is excused", icon: LaptopIcon, module: "attendance", action: "configure" },
      { href: "/flows/users", label: "Team & profiles", short: "Team", hint: "People, departments, who reports to whom, photos and details", icon: UsersIcon, module: "employees", reach: true },
      { href: "/flows/holidays", label: "Holidays", short: "Holidays", hint: "Company holidays, year by year", icon: CalendarDaysIcon, module: "attendance" },
      { href: "/flows/team", label: "Absence cover", short: "Absence", hint: "Cover for someone who is away", icon: CalendarOffIcon, module: "attendance" },
    ],
  },
  {
    title: "Secure",
    items: [
      { href: "/flows/vault", label: "Credential vault", short: "Vault", hint: "Shared logins, encrypted — only what is assigned to you", icon: KeyRoundIcon, module: "vault" },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/flows/admin", label: "Control center", hint: "Everything the Super Admin decides, and what needs attention", icon: SlidersHorizontalIcon, super: true },
      { href: "/flows/console", label: "Super Admin console", short: "Console", hint: "Correct any record by hand, restore deleted rows, data checks, announcements", icon: WrenchIcon, super: true },
      { href: "/flows/access", label: "Access & roles", hint: "Decide what a Manager and a User can do", icon: ShieldCheckIcon, super: true },
      { href: "/flows/settings", label: "Settings", hint: "Company rules, attendance, reminders, scorecard benchmark", icon: SettingsIcon, super: true },      { href: "/flows/audit", label: "Activity log", hint: "Every change: who did what and when", icon: HistoryIcon, module: "audit" },
    ],
  },
];
const FOOT: NavItem[] = [
  { href: "/flows/help", label: "How it works", hint: "A 2-minute guide in simple words", icon: HelpCircleIcon },
  { href: "/flows/profile", label: "My profile", short: "Profile", hint: "Your photo, details, PIN and how you get alerts", icon: UserCogIcon },
];

/** What a person sees when they open a page they do not have. The data is refused by the server as well. */
function NoAccess() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border bg-card p-8 text-center shadow-[0_1px_1px_rgba(60,66,87,0.04),0_2px_5px_rgba(60,66,87,0.05)]">
      <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-[#efeeff] text-primary"><LockIcon className="size-5" /></span>
      <h1 className="text-lg font-semibold">You do not have access to this page</h1>
      <p className="mt-1 text-sm text-muted-foreground">Ask the Super Admin if you need it. Nothing from this page is shown to you.</p>
      <Link href="/flows/panel" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white">Go to Home</Link>
    </div>
  );
}

export function AppShell({ user, children }: { user: { userId: string; name: string; role: Role }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, call, refresh } = useFlows();
  const [more, setMore] = useState(false);
  const [inbox, setInbox] = useState(false);
  const [find, setFind] = useState(false);
  const role = (data?.me.role as Role | undefined) ?? user.role;
  const groups = useMemo(() => {
    const hasFlow = role === "SUPER_ADMIN" || (data?.flows ?? []).length > 0; // an FMS tab for somebody who has been given no FMS would only lead to an empty page
    const has = (m: ModuleId) => !!data?.perms?.[m]?.a.includes("view");
    const allowed = (n: NavItem) => (n.href !== "/flows/kiosk" || !!data?.perms?.attendance?.a.includes("manage") || data?.settings?.ATT_SELF_PUNCH === "N") && (n.href !== "/flows/approvals" || (has("fms") && hasFlow) || has("checklist") || has("attendance")) && (!(n.module === "fms" && n.href !== "/flows/search") || hasFlow) && (!n.module || !!data?.perms?.[n.module]?.a.includes(n.action ?? "view")) && (!n.reach || (data?.reach?.[n.module!]?.all ?? false) || (data?.reach?.[n.module!]?.ids.length ?? 0) > 1) && (!n.super || role === "SUPER_ADMIN");
    return GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length);
  }, [role, data?.perms, data?.reach, data?.flows, data?.settings?.ATT_SELF_PUNCH]);
  const flat = useMemo(() => [...groups.flatMap((g) => g.items), ...FOOT], [groups]);
  const pendingApprovals = (data?.requests ?? []).filter((r) => r.status === "Pending").length;
  const unread = data?.unread ?? 0;
  const badge = (n: NavItem) => (n.badge === "approvals" ? pendingApprovals : 0);

  // Ctrl / ⌘ + K opens the quick search from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setFind(true); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  // longest matching href wins so /flows/tasks does not also light up /flows
  const activeHref = flat.filter((n) => pathname === n.href || pathname.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const active = (href: string) => href === activeHref;
  const palettePages = useMemo(() => flat.map((n) => ({ href: n.href, label: n.label, hint: n.hint, icon: <n.icon className="size-4" /> })), [flat]);

  const bell = (
    <button onClick={() => setInbox(true)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
      <BellIcon className="size-[1.15rem]" />
      {unread > 0 && <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
    </button>
  );
  const dot = (n: NavItem) => badge(n) > 0 && <span className="ml-auto rounded-[5px] bg-primary px-1.5 text-[10.5px] font-semibold text-white">{badge(n)}</span>;
  const link = (n: NavItem) => (
    <Link key={n.href} href={n.href} title={n.hint} aria-current={active(n.href) ? "page" : undefined}
      className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] font-medium transition-colors", active(n.href) ? "bg-[#efeeff] text-[#4b3fd6]" : "text-[#3c4257] hover:bg-sidebar-accent hover:text-foreground")}>
      <n.icon className={cn("size-[1.05rem]", active(n.href) ? "text-primary" : "text-[#8792a2]")} /> {n.label} {dot(n)}
    </Link>
  );

  const tabs = ["/flows/panel", "/flows/kiosk", "/flows/leaderboard", "/flows/tasks", "/flows/checklist", "/flows/attendance", "/flows/quick"].map((h) => flat.find((n) => n.href === h)).filter((n): n is NavItem => !!n).slice(0, 3);
  const need = requirement(pathname);
  const denied = !!data && need !== null && (need === "super" ? role !== "SUPER_ADMIN" : !data.perms?.[need[0]]?.a.includes(need[1]));
  // a page the person was just given access to (a shared login, a new role): look again once before saying "no access"
  const askedAgain = useRef("");
  useEffect(() => { if (denied && askedAgain.current !== pathname) { askedAgain.current = pathname; refresh(); } }, [denied, pathname, refresh]);
  const company = data?.settings?.COMPANY_NAME || "Parag Unify Crafts";
  const myCode = data?.users.find((u) => u.userId === data.me.userId)?.empCode ?? "";

  return (
    <div className="min-h-dvh md:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <div className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white shadow-[0_1px_2px_rgba(99,91,255,0.4)]">{company.slice(0, 1)}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold leading-tight text-foreground">{company}</div><div className="text-xs text-muted-foreground">Management panel</div></div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 pb-2" aria-label="Main">
          {groups.map((g) => (
            <div key={g.title || "top"} className={cn(g.title && "mt-4")}>
              {g.title && <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#8792a2]">{g.title}</div>}
              <div className="space-y-px">{g.items.map((n) => link(n))}</div>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-2.5 py-2">{FOOT.map((n) => link(n))}</div>
        <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-2.5">
          <Avatar userId={data?.me.userId ?? user.userId} size={32} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold text-foreground">{data?.me.name ?? user.name}</div><div className="truncate text-xs text-muted-foreground">{ROLE_LABEL[role]}{data?.me.department ? ` · ${data.me.department}` : ""}</div>{myCode && <div className="truncate text-[11px] tabular-nums text-muted-foreground">ID {myCode}</div>}</div>
          <button onClick={logout} aria-label="Sign out" title="Sign out" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><LogOutIcon className="size-4" /></button>
        </div>
      </aside>

      {/* desktop top bar: search, today's attendance, bell */}
      <div className="sticky top-0 z-20 hidden h-14 items-center gap-3 border-b bg-card/90 px-6 backdrop-blur md:flex">
        <button onClick={() => setFind(true)} className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-[13px] text-muted-foreground shadow-[0_1px_1px_rgba(26,31,54,0.04)] hover:border-[#b4bcc8]">
          <SearchIcon className="size-4" /> <span className="flex-1">Search pages, FMS and people…</span><kbd className="rounded border bg-muted px-1.5 text-[10.5px]">Ctrl K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-2"><div className="w-56"><DayChip tone="light" /></div>{bell}</div>
      </div>

      {/* phone header */}
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-2 border-b bg-card px-3 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">{company.slice(0, 1)}</div>
          <div className="w-44 min-w-0"><DayChip tone="light" /></div>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setFind(true)} aria-label="Search" className="rounded-md p-2 text-muted-foreground"><SearchIcon className="size-5" /></button>
          {bell}
        </div>
      </header>

      {data && !data.live && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          Demo mode — test data, not your Google Sheet.<span className="hidden sm:inline"> Set <b>GOOGLE_SHEET_ID</b> and the service account to go live.</span>
        </div>
      )}
      <CheckOutNudge />
      <main id="main" className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8"><Gate>{denied ? <NoAccess /> : children}</Gate></main>
      <CheckInGate />

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        <div className="grid grid-cols-4 items-end">
          {tabs.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active(n.href) ? "font-semibold text-primary" : "text-muted-foreground")}>
              <n.icon className="size-5" />{n.short ?? n.label}
            </Link>
          ))}
          <button onClick={() => setMore(true)} className="relative flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"><MenuIcon className="size-5" />More{pendingApprovals > 0 && <span className="absolute right-[26%] top-1 size-2 rounded-full bg-primary" />}</button>
        </div>
      </nav>

      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-6">
          <SheetHeader><SheetTitle>{data?.me.name ?? user.name} · {ROLE_LABEL[role]}</SheetTitle></SheetHeader>
          <div className="grid gap-3 px-4">
            {groups.map((g) => (
              <div key={g.title || "top"}>
                {g.title && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</div>}
                <div className="grid grid-cols-3 gap-2">
                  {g.items.map((n) => (
                    <Link key={n.href} href={n.href} onClick={() => setMore(false)} className={cn("relative flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center text-xs", active(n.href) ? "border-primary bg-[#efeeff] text-[#4b3fd6]" : "bg-card text-foreground")}>
                      <n.icon className="size-5" /> {n.label}
                      {badge(n) > 0 && <span className="absolute right-1.5 top-1.5 rounded-[5px] bg-primary px-1.5 text-[10px] font-semibold text-white">{badge(n)}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              {FOOT.map((n) => <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex items-center justify-center gap-2 rounded-lg border bg-card p-2.5 text-xs"><n.icon className="size-4" /> {n.label}</Link>)}
            </div>
            <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-md border bg-card py-2.5 text-sm text-muted-foreground"><LogOutIcon className="size-4" /> Sign out</button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={inbox} onOpenChange={setInbox}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between pr-8">
              Notifications
              {unread > 0 && <button className="flex items-center gap-1 text-xs font-normal text-primary" onClick={() => call("markNotificationsRead", { all: true })}><CheckCheckIcon className="size-4" /> Mark all read</button>}
            </SheetTitle>
          </SheetHeader>
          <div className="grid gap-1.5 px-4 pb-6">
            {(data?.notifications ?? []).length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing yet. Reminders, overdue alerts, approvals and backup assignments show up here.</p>}
            {(data?.notifications ?? []).map((n) => (
              <button
                key={n.notifId}
                onClick={() => { if (!n.readAt) call("markNotificationsRead", { ids: [n.notifId] }); setInbox(false); if (n.link) router.push(n.link); }}
                className={cn("rounded-lg border p-2.5 text-left text-sm", !n.readAt ? "border-primary/30 bg-[#efeeff]/60" : "bg-card")}
              >
                <div className="flex items-start justify-between gap-2"><span className={cn("font-medium", n.readAt && "font-normal")}>{n.title}</span>{!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}</div>
                {n.body && <div className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{n.body}</div>}
                <div className="mt-1 text-[10px] text-muted-foreground">{fmtDT(n.createdAt)}</div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <CommandPalette open={find} onClose={() => setFind(false)} pages={palettePages} />
    </div>
  );
}
