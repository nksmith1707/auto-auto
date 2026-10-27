// Review a partner application from the Render shell until the Ops Console (step 12) has screens for it.
// Usage:
//   npm run partner-review -- partner@email.com            show the application checklist
//   npm run partner-review -- partner@email.com approve    approve documents, record background as clear, approve
//   npm run partner-review -- partner@email.com return "What to fix"
//   npm run partner-review -- partner@email.com deny "Reason"
// Until a background-check vendor is chosen, "approve" records the check as clear. Only use it after checking yourself.
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import { migrate } from "../src/db/migrate.js";
import { createOnboarding } from "../src/onboarding/service.js";

const [email, action, ...rest] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run partner-review -- partner@email.com [approve | return "note" | deny "note"]');
  process.exit(1);
}
const config = loadConfig();
const db = await openDb(config.databaseUrl, { ssl: config.databaseSsl });
await migrate(db);
const staff = { id: "script" };
try {
  const u = await db.get(`SELECT id FROM users WHERE email = $1 AND role = 'partner'`, [email.trim().toLowerCase()]);
  if (!u) throw new Error(`No partner account with the email ${email}.`);
  const ob = createOnboarding({ db, payments: { enabled: !!config.stripeSecretKey } });
  let v = await ob.staffView(u.id);
  if (action === "approve") {
    for (const d of v.documents) if (d.status !== "approved") await ob.reviewDocument(staff, d.id, { status: "approved" });
    if (v.background.status !== "clear") await ob.setBackground(staff, u.id, { status: "clear", note: "Marked clear with partner-review script (no vendor yet)" });
    v = await ob.decide(staff, u.id, { decision: "approve" });
  } else if (action === "return" || action === "deny") {
    v = await ob.decide(staff, u.id, { decision: action, note: rest.join(" ") });
  } else if (action) throw new Error(`Unknown action "${action}". Use approve, return, or deny.`);
  console.log(`${v.partner.name} <${v.partner.email}> · status: ${v.status}${v.submittedAt ? ` · submitted ${new Date(v.submittedAt).toLocaleString("en-US")}` : ""}`);
  console.log(`ID check: ${v.identity.status}${v.identity.over21 === false ? " (under 21)" : ""} · background: ${v.background.status}`);
  for (const s of v.steps) console.log(`  ${s.done ? "✓" : "✗"} ${s.title}${s.done ? "" : ` — ${s.errors.join("; ")}`}`);
  for (const d of v.documents) console.log(`  document: ${d.label} (${d.filename}) — ${d.status}`);
} catch (e) {
  console.error(e.extra && e.extra.blockers ? `Can't approve yet:\n  ${e.extra.blockers.join("\n  ")}` : e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
