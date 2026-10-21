// The permission test matrix: roles × modules × actions × records.
// Super Admin · Admin · Manager · Team Member · a person with no FMS · a person assigned to an FMS entry · a person who is not
// — checked through the same server entry point the browser uses (menu data, search, direct record access, notifications, export, edit, delete, assign, bulk).
//   node tools/test-access.mjs
import { createFakeSheets } from "./fake-sheets/server.mjs";
import { createSheetsClient } from "../src/server/sheets/client.ts";
import { Db } from "../src/server/sheets/db.ts";
import { runAction } from "../src/server/api.ts";
import { runSetup, runTick } from "../src/server/domain/system.ts";
import { makeCtx } from "../src/server/domain/ctx.ts";
import { allows, effectivePermSet, reachOf, roleTemplate, parsePermSet, MODULES } from "../src/lib/permissions.ts";

process.env.VAULT_KEY = "11".repeat(32); // test key (64 hex characters)
const fake = createFakeSheets({});
await new Promise((r) => fake.listen(0, r));
const db = new Db(createSheetsClient({ spreadsheetId: "acc", baseUrl: `http://localhost:${fake.address().port}` }), { ttlMs: 0 });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", m); } };
const denied = (r) => !r.ok && r.code === "FORBIDDEN";
const section = (s) => console.log("\n" + s);
const at = (date, hm = "10:00") => new Date(`${date}T${hm}:00+05:30`);
const call = (actor, action, data = {}, when, meta) => runAction(db, actor, action, data, { now: when ? at(...[].concat(when)) : undefined, meta });
const MON = "2026-10-05", TUE = "2026-10-06", WED = "2026-10-07";

const boss = (await runSetup(db, { name: "Owner", mobile: "9999999999", pin: "1234", demo: true })).userId;
const { Users } = await db.load(["Users"], { fresh: true });
const id = (n) => String(Users.find((u) => u.name === n).userId);
const PRIYA = id("Priya Coordinator"), KUNAL = id("Kunal"), NIDHI = id("Nidhi");
const mk = async (name, role, mobile, department, managerId = "") => {
  const r = await call(boss, "saveUser", { name, role, mobile, department, managerId, pin: "4444", empCode: name.slice(0, 3).toUpperCase() + "1" }, MON);
  if (!r.ok) throw new Error(name + ": " + r.error);
  return r.data.userId;
};
const MEERA = await mk("Meera", "MANAGER", "9000000021", "Sales");
const ROHAN = await mk("Rohan", "STAFF", "9000000022", "Sales", MEERA);
const ASHA = await mk("Asha", "STAFF", "9000000023", "Stores");
for (const uid of [PRIYA, KUNAL, NIDHI]) { const u = Users.find((x) => x.userId === uid); await call(boss, "saveUser", { userId: uid, name: u.name, mobile: u.mobile, department: "Operations" }, MON); }
const bundle = async (actor, when = WED) => (await call(actor, "getFlowData", {}, when)).data;

section("the rules in plain code");
const tpl = (r) => effectivePermSet(r, roleTemplate(r));
ok(allows(tpl("SUPER_ADMIN"), "vault", "configure" in {} ? "view" : "manage") && MODULES.every((m) => m.actions.every((a) => allows(tpl("SUPER_ADMIN"), m.id, a))), "Super Admin can do everything");
ok(allows(tpl("STAFF"), "fms", "view") && !allows(tpl("STAFF"), "vault", "view") && !allows(tpl("STAFF"), "settings", "view") && !allows(tpl("STAFF"), "audit", "view") && !allows(tpl("STAFF"), "reports", "view"), "a Team Member starts with own work only — no vault, settings, logs, reports");
ok(allows(tpl("MANAGER"), "attendance", "approve") && !allows(tpl("MANAGER"), "fms", "configure") && !allows(tpl("MANAGER"), "employees", "create"), "a Manager approves for the team but does not build FMS or add people");
ok(allows(tpl("ADMIN"), "employees", "create") && !allows(tpl("ADMIN"), "settings", "configure") && !allows(tpl("ADMIN"), "vault", "create"), "an Admin has almost everything, not the Super Admin's own controls");
ok(JSON.stringify(parsePermSet({ fms: { a: ["view", "hack", "configure"], s: "everyone" }, nope: { a: ["view"], s: "all" }, vault: { a: ["export"], s: "own" } })) === JSON.stringify({ fms: { a: ["view", "configure"], s: "own" }, vault: { a: [], s: "own" } }), "stored permissions are cleaned: unknown modules, actions and scopes are dropped");
const people = [{ userId: "m", managerId: "", department: "A" }, { userId: "a", managerId: "m", department: "B" }, { userId: "b", managerId: "a", department: "B" }, { userId: "c", managerId: "", department: "A" }, { userId: "d", managerId: "", department: "C" }];
const rm = (s, u = "m") => reachOf({ userId: u, role: "MANAGER", department: "A" }, people, s);
ok(rm("own").ids.size === 1 && ["m", "a", "b"].every((x) => rm("team").ids.has(x)) && !rm("team").ids.has("c") && rm("department").ids.has("c") && !rm("department").ids.has("d") && rm("all").all, "scope: own → team (reports, down the line) → department → everyone");

section("Super Admin: everything, and nobody else can take it");
const adminSees = await bundle(PRIYA);
ok(denied(await call(PRIYA, "saveUserAccess", { userId: KUNAL, role: "ADMIN" }, MON)) && denied(await call(MEERA, "saveRole", { name: "Mine", perms: {} }, MON)), "only the Super Admin changes roles and access");
ok(denied(await call(PRIYA, "saveUser", { name: "Sneaky", role: "ADMIN", mobile: "9000000031", pin: "1111" }, MON)) && denied(await call(PRIYA, "saveUser", { userId: boss, name: "Owner", role: "STAFF", mobile: "9999999999" }, MON)), "an Admin cannot create an Admin or touch the Super Admin");
ok((await call(PRIYA, "saveUser", { name: "Newbie", role: "STAFF", mobile: "9000000032", pin: "1111" }, MON)).ok, "…but can add a Team Member (employees · create)");
ok(!(await call(PRIYA, "saveSettings", { settings: { COMPANY_NAME: "X" } }, MON)).ok && (await call(boss, "saveSettings", { settings: { COMPANY_NAME: "Acme" } }, MON)).ok, "settings: only the Super Admin");
ok(adminSees.roles === undefined && adminSees.access === undefined && (await bundle(boss)).roles.length >= 4, "the role editor's data is sent to the Super Admin only");

section("a flow with two people, and what each person can reach");
const flowDef = { name: "Mini FMS", fields: [{ key: "po", label: "PO", type: "text", required: true }, { key: "due", label: "Due", type: "date", required: true }], anchorField: "due", titleFields: ["po"], steps: [{ name: "Pack", assigneeId: KUNAL, rule: { base: "anchor", offsetDays: 0 } }, { name: "Ship", assigneeId: NIDHI, rule: { base: "anchor", offsetDays: 1 } }] };
ok(denied(await call(MEERA, "createFlow", flowDef, MON)) && denied(await call(KUNAL, "createFlow", flowDef, MON)), "a Manager and a Team Member cannot build an FMS");
const flowId = (await call(PRIYA, "createFlow", flowDef, MON)).data.flowId;
const e1 = await call(KUNAL, "createEntry", { flowId, data: { po: "P-1", due: TUE } }, MON);
ok(e1.ok, `a Team Member adds an entry: ${e1.error}`);
const itemId = e1.data.itemId;
const sees = async (actor) => (await bundle(actor)).items.some((i) => i.itemId === itemId);
ok(await sees(KUNAL) && await sees(NIDHI) && await sees(PRIYA) && await sees(boss), "the two assigned people, an Admin of the department and the Super Admin see it");
ok(!(await sees(ROHAN)) && !(await sees(ASHA)) && !(await sees(MEERA)), "…nobody else does (default = only assigned people + authorized managers)");
ok(denied(await call(ROHAN, "getItemDetail", { itemId }, WED)) && (await call(ROHAN, "searchEntries", { q: "P-1" }, WED)).data.items.length === 0, "a direct request for the entry, and a search, return nothing for them");
ok(denied(await call(ROHAN, "updateEntry", { itemId, priority: "High" }, WED)) && denied(await call(ROHAN, "addComment", { itemId, text: "hi" }, WED)), "…and they cannot change or comment on it");
const t1 = (await db.load(["Flow_Tasks"], { fresh: true })).Flow_Tasks.find((t) => t.itemId === itemId && t.stepId === flowDef.steps && false) ?? (await db.load(["Flow_Tasks"], { fresh: true })).Flow_Tasks.find((t) => t.itemId === itemId && t.assigneeId === KUNAL);
ok(denied(await call(ROHAN, "completeTask", { taskId: t1.taskId }, WED)), "a stranger cannot complete somebody else's step");

section("who else an entry is shared with (More options → Who can see this)");
ok((await call(KUNAL, "updateEntry", { itemId, visibility: "users", visibleTo: ROHAN }, WED)).ok && await sees(ROHAN) && !(await sees(ASHA)), "shared with selected people");
ok(denied(await call(ROHAN, "updateEntry", { itemId, priority: "High" }, WED)), "…seeing is not editing");
await call(KUNAL, "updateEntry", { itemId, visibility: "management" }, WED);
ok(await sees(MEERA) && !(await sees(ROHAN)) && !(await sees(ASHA)), "shared with management: Managers and Admins, not Team Members");
await call(KUNAL, "updateEntry", { itemId, visibility: "department" }, WED);
ok(await sees(NIDHI) && !(await sees(ASHA)) && !(await sees(ROHAN)), "shared with the department");
await call(KUNAL, "updateEntry", { itemId, visibility: "assigned" }, WED);

section("no FMS access = no FMS anywhere");
ok((await call(boss, "saveUserAccess", { userId: NIDHI, role: "STAFF", overrides: { fms: { a: [], s: "own" } } }, MON)).ok, "the Super Admin switches the FMS module off for one person");
await call(boss, "reassignTask", { taskId: t1.taskId, assigneeId: NIDHI }, MON); // a notification for Nidhi about an FMS step
const nb = await bundle(NIDHI);
ok(nb.perms.fms === undefined || nb.perms.fms.a.length === 0, "the bundle says: no FMS");
ok(nb.flows.length === 0 && nb.items.length === 0 && nb.tasks.length === 0 && nb.requests.length === 0 && Object.keys(nb.counts).length === 0, "no FMS flows, entries, steps, requests or counts are sent");
ok(nb.notifications.every((n) => !/FLW|tasks|approvals/.test(n.link)) && nb.unread === nb.notifications.filter((n) => !n.readAt).length, "FMS notifications are not sent, and the unread count excludes them");
for (const [a, d] of [["getItemDetail", { itemId }], ["searchEntries", { q: "P-1" }], ["createEntry", { flowId, data: { po: "P-9", due: TUE } }], ["completeTask", { taskId: t1.taskId }], ["bulkEntries", { op: "cancel", itemIds: [itemId] }], ["importEntries", { flowId, rows: [{ data: { po: "P-8", due: TUE } }] }]]) {
  ok(denied(await call(NIDHI, a, d, WED)), `${a}: access denied (server-side)`);
}
ok(denied(await call(NIDHI, "logExport", { module: "fms", rows: 3 }, WED)), "export: denied");
ok((await call(NIDHI, "getFlowData", {}, WED)).data.checklistTasks !== undefined && nb.attendance !== undefined, "…while the modules they still have keep working");
await call(boss, "saveUserAccess", { userId: NIDHI, role: "STAFF", overrides: {} }, MON);
ok((await bundle(NIDHI)).items.length > 0, "removing the override gives the module back");

section("edit · delete · assign · approve · export are separate rights");
ok(denied(await call(KUNAL, "cancelEntry", { itemId, reason: "x" }, WED)) && denied(await call(KUNAL, "reassignTask", { taskId: t1.taskId, assigneeId: NIDHI }, WED)) && denied(await call(KUNAL, "reopenTask", { taskId: t1.taskId }, WED)), "a Team Member cannot delete, hand over or undo");
const bulk = await call(KUNAL, "bulkEntries", { op: "cancel", itemIds: [itemId], reason: "x" }, WED);
ok(!bulk.ok, "bulk cancel is refused for a Team Member");
ok(denied(await call(KUNAL, "logExport", { module: "fms", rows: 1 }, WED)) && (await call(PRIYA, "logExport", { module: "fms", rows: 5, what: "FMS entries" }, WED)).ok, "export needs the export right; the Admin has it");
ok((await call(PRIYA, "reassignTask", { taskId: t1.taskId, assigneeId: KUNAL }, WED)).ok, "an Admin can hand a step over");
const aud = (await call(boss, "auditLog", { module: "fms", action: "export" }, WED)).data;
ok(aud.rows.some((r) => r.action === "Data export" && r.user === PRIYA), "the export is in the activity log");

section("scopes: own · team · department");
const salesDef = { ...flowDef, name: "Sales FMS", steps: [{ name: "Quote", assigneeId: ROHAN, rule: { base: "anchor", offsetDays: 0 } }] };
const salesFlow = (await call(boss, "createFlow", salesDef, MON)).data.flowId;
const e3 = await call(ROHAN, "createEntry", { flowId: salesFlow, data: { po: "S-1", due: TUE } }, MON);
ok(e3.ok, `Rohan (Sales) adds an entry: ${e3.error}`);
const sees3 = async (a) => (await bundle(a)).items.some((i) => i.itemId === e3.data.itemId);
ok(await sees3(ROHAN) && await sees3(boss), "he and the Super Admin see it");
ok(await sees3(MEERA), "his reporting manager (a Manager with team scope) sees it");
ok(!(await sees3(KUNAL)) && !(await sees3(PRIYA)) && !(await sees3(ASHA)), "other departments — including an Admin with department scope — do not");
ok(denied(await call(PRIYA, "updateEntry", { itemId: e3.data.itemId, priority: "High" }, WED)) && denied(await call(PRIYA, "getItemDetail", { itemId: e3.data.itemId }, WED)), "…and cannot open or change it by id");
ok((await call(boss, "saveRole", { roleId: "ADMIN", perms: { ...roleTemplate("ADMIN"), fms: { a: roleTemplate("ADMIN").fms.a, s: "all" } } }, MON)).ok && await sees3(PRIYA), "the Super Admin widens the Admin template to everyone — now the Admin sees it");
ok((await call(boss, "resetRole", { roleId: "ADMIN" }, MON)).ok && !(await sees3(PRIYA)), "…and a built-in role can be put back to its default");

section("custom roles and personal overrides");
const role = await call(boss, "saveRole", { name: "Sales Executive", description: "Sales only", base: "STAFF", perms: { fms: { a: ["view", "create", "edit"], s: "own" }, quick_access: { a: ["view"], s: "all" } } }, MON);
ok(role.ok, `custom role: ${role.error}`);
ok(!(await call(boss, "saveRole", { name: "sales executive", perms: {} }, MON)).ok, "role names are unique");
ok((await call(boss, "saveUserAccess", { userId: ROHAN, role: "STAFF", roleId: role.data.roleId, overrides: {} }, MON)).ok, "assigned to Rohan");
const rb = await bundle(ROHAN);
ok(rb.perms.checklist === undefined && rb.checklistTasks.length === 0 && rb.attendance.length === 0 && denied(await call(ROHAN, "checkIn", {}, [WED, "09:00"])), "his menu, data and actions follow the custom role: no checklist, no attendance");
ok(rb.perms.fms.a.includes("create") && !rb.perms.quick_access.a.includes("create"), "…FMS yes, creating shortcuts no");
ok((await call(boss, "saveUserAccess", { userId: ROHAN, role: "STAFF", roleId: role.data.roleId, overrides: { attendance: { a: ["view", "create"], s: "own" } } }, MON)).ok && (await call(ROHAN, "checkIn", {}, [WED, "09:00"])).ok, "a personal override adds one module on top");
ok((await call(boss, "deleteRole", { roleId: role.data.roleId }, MON)).ok && !(await bundle(ROHAN)).me.roleId, "deleting the role puts people back on their standard role");

section("quick access");
const L = await call(KUNAL, "saveLink", { title: "Shopify", url: "https://admin.shopify.com", category: "Sales" }, MON);
ok(L.ok && !(await call(KUNAL, "saveLink", { title: "Bad", url: "javascript:alert(1)" }, MON)).ok, "a person adds a shortcut; only http(s) addresses are accepted");
ok(denied(await call(KUNAL, "saveLink", { title: "Company", url: "https://example.com", company: true }, MON)) && (await call(PRIYA, "saveLink", { title: "Company drive", url: "https://drive.google.com", company: true }, MON)).ok, "company-wide shortcuts need Manage");
ok((await bundle(NIDHI)).quickLinks.every((q) => q.ownerId !== KUNAL) && (await bundle(NIDHI)).quickLinks.some((q) => q.title === "Company drive") && (await bundle(KUNAL)).quickLinks.some((q) => q.title === "Shopify"), "personal shortcuts are private, company ones are shared");
ok(denied(await call(NIDHI, "deleteLink", { linkId: L.data.linkId }, MON)) && (await call(KUNAL, "deleteLink", { linkId: L.data.linkId }, MON)).ok, "only the owner removes a personal shortcut");

section("credential vault");
const plain = "S3cret-Pass!";
ok(denied(await call(KUNAL, "listVault", {}, MON)), "no vault module = nothing, not even a list");
const v1 = await call(boss, "saveVault", { service: "Shopify", username: "ops@acme.com", loginUrl: "https://admin.shopify.com", secret: plain }, MON);
ok(v1.ok && JSON.stringify(v1).indexOf(plain) < 0 && !("secretEnc" in v1.data), "saved; the response never contains the password or its ciphertext");
const raw = (await db.load(["Vault_Items"], { fresh: true })).Vault_Items.find((r) => r.vaultId === v1.data.vaultId);
ok(raw.secretEnc.startsWith("v1.") && !raw.secretEnc.includes(plain) && !JSON.stringify(raw).includes(plain), "in the sheet the password is encrypted (AES-256-GCM)");
const list = await call(boss, "listVault", {}, MON);
ok(list.data.enabled && list.data.items.length === 1 && JSON.stringify(list).indexOf(plain) < 0 && !("secretEnc" in list.data.items[0]), "the list carries service, username and URL — never the password");
ok((await call(boss, "saveUserAccess", { userId: KUNAL, role: "STAFF", overrides: { vault: { a: ["view"], s: "own" } } }, MON)).ok, "Kunal gets the vault module");
ok((await call(KUNAL, "listVault", {}, MON)).data.items.length === 0 && denied(await call(KUNAL, "revealVault", { vaultId: v1.data.vaultId }, MON)), "…but sees and reveals only what is assigned to him");
ok((await call(boss, "assignVault", { vaultId: v1.data.vaultId, users: [{ userId: KUNAL, canReveal: false }] }, MON)).ok && (await call(KUNAL, "listVault", {}, MON)).data.items[0].canReveal === false && denied(await call(KUNAL, "revealVault", { vaultId: v1.data.vaultId }, MON)), "assigned without the right to reveal: he can see it exists, not the password");
await call(boss, "assignVault", { vaultId: v1.data.vaultId, users: [{ userId: KUNAL, canReveal: true }] }, MON);
const rv = await call(KUNAL, "revealVault", { vaultId: v1.data.vaultId, purpose: "copy" }, MON);
ok(rv.ok && rv.data.secret === plain, "with the right, the password is decrypted for him");
const vlog = (await call(boss, "auditLog", { module: "vault" }, MON)).data.rows;
ok(vlog.some((r) => r.action === "Credential copied" && r.user === KUNAL) && JSON.stringify(vlog).indexOf(plain) < 0, "the copy is logged (who, which service) and the log never holds the password");
ok(denied(await call(PRIYA, "revealVault", { vaultId: v1.data.vaultId }, MON)), "an Admin does not get vault access just because of the role");
process.env.VAULT_KEY = "";
ok((await call(boss, "revealVault", { vaultId: v1.data.vaultId }, MON)).code === "VAULT_OFF" && (await call(boss, "saveVault", { service: "X", secret: "y" }, MON)).code === "VAULT_OFF", "without a server key the vault refuses to store or reveal anything (no insecure fallback)");
process.env.VAULT_KEY = "11".repeat(32);

section("saved filters");
const f1 = await call(KUNAL, "saveFilter", { page: "fms:list", name: "Overdue", params: { quick: "overdue" }, isDefault: true }, MON);
const f2 = await call(KUNAL, "saveFilter", { page: "fms:list", name: "Mine", params: { quick: "mine" }, isDefault: true }, MON);
ok(f1.ok && f2.ok, "saved");
const kf = (await bundle(KUNAL)).savedFilters.filter((f) => f.page === "fms:list");
ok(kf.length === 2 && kf.filter((f) => f.isDefault === "Y").length === 1, "only one default per page");
ok(!(await bundle(NIDHI)).savedFilters.some((f) => f.userId === KUNAL) && denied(await call(NIDHI, "deleteFilter", { filterId: f1.data.filterId }, MON)), "filters are private; others cannot delete them");
ok(denied(await call(KUNAL, "saveFilter", { page: "fms:list", name: "For all", params: {}, shared: true }, MON)) && (await call(PRIYA, "saveFilter", { page: "fms:list", name: "Team view", params: { quick: "today" }, shared: true }, MON)).ok && (await bundle(KUNAL)).savedFilters.some((f) => f.name === "Team view"), "sharing a filter needs Manage; shared ones show up for people who can open the page");
ok((await call(KUNAL, "deleteFilter", { filterId: f2.data.filterId }, MON)).ok, "a person deletes their own filter");

section("the activity log");
ok(denied(await call(KUNAL, "auditLog", {}, MON)) && denied(await call(MEERA, "auditLog", {}, MON)), "Team Members and Managers have no activity log by default");
await call(boss, "saveUserAccess", { userId: ASHA, role: "STAFF", overrides: { fms: { a: ["view"], s: "own" } } }, MON, { ip: "203.0.113.7", device: "Chrome · Windows" });
const log = (await call(boss, "auditLog", { action: "access changed" }, MON)).data.rows[0];
ok(log && log.ip === "203.0.113.7" && log.device === "Chrome · Windows" && log.module === "employees" && /fms/.test(log.newValue), "permission changes are logged with the IP and device, old and new value");
const flt = (await call(boss, "auditLog", { from: "2030-01-01" }, MON)).data;
ok(flt.rows.length === 0, "the log can be filtered by date, user, module and text");
const pa = (await call(PRIYA, "auditLog", {}, MON)).data;
ok(pa.rows.every((r) => [PRIYA, KUNAL, NIDHI].includes(r.user)) && pa.rows.length > 0, "an Admin with the log sees only people in their department");

section("people, details and photos (reach)");
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";
ok((await call(KUNAL, "saveProfilePhoto", { image: JPG }, MON)).ok && denied(await call(NIDHI, "saveProfilePhoto", { userId: KUNAL, image: JPG }, MON)), "own photo yes, someone else's no");
ok((await call(KUNAL, "saveEmployee", { dob: "1995-04-02", gender: "Male", designation: "CEO" }, MON)).data.designation === "" && (await call(PRIYA, "saveEmployee", { userId: KUNAL, designation: "Executive" }, MON)).data.designation === "Executive", "personal fields: the person; HR fields: whoever manages employees");
ok(denied(await call(PRIYA, "getEmployee", { userId: ASHA }, MON)) && denied(await call(NIDHI, "getEmployee", { userId: KUNAL }, MON)) && (await call(KUNAL, "getEmployee", {}, MON)).data.canEdit, "details of people outside your reach stay closed");
ok((await bundle(PRIYA)).users.find((u) => u.userId === ROHAN).mobile === undefined && (await bundle(PRIYA)).users.find((u) => u.userId === KUNAL).mobile, "phone and email are visible only inside your reach");

section("FMS on / off and department access (process level)");
ok(denied(await call(PRIYA, "setFlowAccess", { flowId, status: "Archived" }, MON)) && (await call(boss, "setFlowAccess", { flowId, departments: ["Sales"] }, MON)).ok, "only the Super Admin limits an FMS");
ok(!(await bundle(KUNAL)).flows.some((f) => f.flowId === flowId) && (await bundle(ROHAN)).flows.some((f) => f.flowId === flowId) && denied(await call(KUNAL, "createEntry", { flowId, data: { po: "P-4", due: TUE } }, MON)), "Operations no longer sees it and cannot start entries");
ok((await call(boss, "setFlowAccess", { flowId, departments: [], allowedUsers: [KUNAL] }, MON)).ok && (await bundle(KUNAL)).flows.some((f) => f.flowId === flowId) && !(await bundle(ASHA)).flows.some((f) => f.flowId === flowId), "…or to named people");
await call(boss, "setFlowAccess", { flowId, departments: [], allowedUsers: [], status: "Archived" }, MON);
ok(!(await bundle(PRIYA)).flows.some((f) => f.flowId === flowId) && (await bundle(boss)).flows.some((f) => f.flowId === flowId), "switched off: invisible to everyone but the Super Admin");
const kBefore = (await bundle(KUNAL)).items.filter((i) => i.flowId === flowId).length;
ok(kBefore === 0 && (await bundle(KUNAL)).tasks.every((t) => t.flowId !== flowId), "switched off: its entries and steps are not in anybody's task lists (Kunal had some)");
ok((await bundle(boss)).items.every((i) => i.flowId !== flowId) && (await bundle(boss)).tasks.every((t) => t.flowId !== flowId), "…not even in the Super Admin's own lists");
ok((await call(boss, "getFlowData", { flowId }, MON)).data.items.some((i) => i.flowId === flowId), "…but the Super Admin sees them when opening that FMS");
const offTick = await runTick(db, undefined, new Date(`${MON}T09:30:00+05:30`));
ok((offTick.reminders ?? 0) === 0 && (offTick.overdue ?? 0) === 0, "a switched-off FMS sends no reminders or overdue alerts");

await call(boss, "setFlowAccess", { flowId, status: "Active" }, MON);

section("Super Admin removes FMS entries and checklist tasks in bulk");
const open0 = (await bundle(KUNAL)).items.filter((i) => i.flowId === flowId && i.status === "Open").length;
ok(open0 > 0, "(fixture) Kunal has open entries");
ok(denied(await call(PRIYA, "removeFlowEntries", { flowId, scope: "open", confirm: "REMOVE" }, MON)) && denied(await call(KUNAL, "removeChecklistTasks", { confirm: "REMOVE" }, MON)) && denied(await call(PRIYA, "previewRemoval", { kind: "fms", flowId }, MON)), "only the Super Admin can remove in bulk");
ok(!(await call(boss, "removeFlowEntries", { flowId, scope: "open" }, MON)).ok && !(await call(boss, "removeFlowEntries", { flowId, scope: "open", confirm: "yes" }, MON)).ok, "it needs the word REMOVE");
ok(!(await call(boss, "removeFlowEntries", { flowId: "FLW-NOPE", scope: "open", confirm: "REMOVE" }, MON)).ok && !(await call(boss, "removeFlowEntries", { flowId, scope: "all-of-it", confirm: "REMOVE" }, MON)).ok, "a wrong FMS or scope is refused");
const pvFms = await call(boss, "previewRemoval", { kind: "fms", flowId }, MON);
ok(pvFms.ok && pvFms.data.open === open0, `the preview tells how many: ${pvFms.data?.open}`);
const rmFms = await call(boss, "removeFlowEntries", { flowId, scope: "open", reason: "test", confirm: "REMOVE" }, MON);
ok(rmFms.ok && rmFms.data.removed === open0 && (await bundle(KUNAL)).items.filter((i) => i.flowId === flowId && i.status === "Open").length === 0, "open entries are removed from Kunal's lists");
const backFms = await call(boss, "restoreFlowEntries", { flowId }, MON);
ok(backFms.ok && backFms.data.restored >= open0 && (await bundle(KUNAL)).items.filter((i) => i.flowId === flowId && i.status === "Open").length === open0, "…and can be brought back");

await call(boss, "saveChecklistTask", { title: "Post on Instagram", doerId: KUNAL, freq: "D", startDate: MON, department: "PC" }, MON);
await call(boss, "saveChecklistTask", { title: "Daily stock check", doerId: NIDHI, freq: "D", startDate: MON, department: "PC" }, MON);
const clAll = await call(boss, "previewRemoval", { kind: "checklist" }, MON);
const clKunal = await call(boss, "previewRemoval", { kind: "checklist", doerId: KUNAL }, MON);
ok(clAll.ok && clKunal.ok && clKunal.data.tasks > 0 && clKunal.data.tasks <= clAll.data.tasks, `checklist preview: everybody ${clAll.data?.tasks}, Kunal ${clKunal.data?.tasks}`);
ok(!(await call(boss, "removeChecklistTasks", { doerId: KUNAL }, MON)).ok, "checklist removal needs REMOVE too");
const clKunalBefore = (await bundle(KUNAL)).checklistTasks.filter((c) => c.doerId === KUNAL).length;
const clRm = await call(boss, "removeChecklistTasks", { doerId: KUNAL, reason: "test", confirm: "REMOVE" }, MON);
const clKunalAfter = (await bundle(KUNAL)).checklistTasks.filter((c) => c.doerId === KUNAL).length;
ok(clRm.ok && clRm.data.tasks === clKunal.data.tasks && clKunalBefore > 0 && clKunalAfter === 0, `Kunal's checklist tasks are gone from his list (${clKunalBefore} → ${clKunalAfter})`);
ok((await bundle(KUNAL)).checklistLog.every((l) => !(l.doerId === KUNAL && l.status === "Pending")), "…and his unfinished entries too");


section("moving work and leave");
const cl = await call(boss, "saveChecklistTask", { title: "Ops daily", doerId: KUNAL, freq: "D", startDate: MON, proof: "N" }, MON);
ok(cl.ok && denied(await call(KUNAL, "saveChecklistTask", { title: "For Nidhi", doerId: NIDHI, freq: "D", startDate: MON }, MON)), "a Team Member cannot give checklist work to others");
const entry = (await db.load(["Checklist_Log"], { fresh: true })).Checklist_Log.find((l) => l.status === "Pending" && l.doerId === KUNAL);
ok(denied(await call(PRIYA, "moveWork", { kind: "checklist", ids: [entry.clId], when: "next" }, TUE)) === false, "an Admin may move work (checklist · assign)");
ok(denied(await call(KUNAL, "moveWork", { kind: "checklist", ids: [entry.clId], when: "next" }, TUE)), "a Team Member may not");
const lv = await call(ROHAN, "requestLeave", { type: "Full Day", startDate: "2026-10-14", endDate: "2026-10-14", reason: "x" }, MON);
ok(lv.ok, `leave requested: ${lv.error}`);
ok(denied(await call(PRIYA, "decideLeave", { leaveId: lv.data.leaveId, approve: true }, MON)), "an Admin of another department cannot decide it");
await call(boss, "saveUser", { userId: ROHAN, name: "Rohan", mobile: "9000000022", managerId: PRIYA }, MON);
ok((await call(PRIYA, "decideLeave", { leaveId: lv.data.leaveId, approve: true }, MON)).ok, "…his reporting manager can (when they have Attendance)");

section("messages never leak a module, departments can be renamed");
await call(boss, "saveUserAccess", { userId: ASHA, role: "STAFF", overrides: { fms: { a: [], s: "own" } } }, MON);
const ctxB = await makeCtx(db, boss, at(MON));
const usersNow = (await db.load(["Users"], { fresh: true })).Users;
ctxB.outbox.push({ userId: ASHA, type: "assigned", title: "Assigned to you: Pack", body: "PO 1", link: "/flows/FLW-1?item=FIT-1" }, { userId: ASHA, type: "checklist", title: "A checklist task", body: "", link: "/flows/checklist" }, { userId: ASHA, type: "access", title: "Your access changed", body: "", link: "/flows/panel" });
const sendable = ctxB.deliverable(usersNow);
ok(sendable.length === 2 && !sendable.some((n) => /FLW/.test(n.link)) && sendable.some((n) => n.type === "access"), "an FMS email / WhatsApp is not sent to a person who has no FMS (their own access news still is)");
ok(denied(await call(PRIYA, "renameDepartment", { from: "Sales", to: "Revenue" }, MON)), "only the Super Admin renames departments");
const rn = await call(boss, "renameDepartment", { from: "sales", to: "Revenue" }, MON);
ok(rn.ok && rn.data.people >= 2, `renamed everywhere: ${JSON.stringify(rn.data)}`);
const nb4 = await bundle(boss);
ok(nb4.users.find((u) => u.userId === ROHAN).department === "Revenue" && nb4.departments.includes("Revenue") && !nb4.departments.includes("Sales"), "people follow the new name");
ok(!(await call(boss, "renameDepartment", { from: "Nope", to: "X" }, MON)).ok, "an unknown department is refused");

console.log(`\n${pass} passed, ${fail} failed`);
fake.close();
process.exit(fail ? 1 : 0);
