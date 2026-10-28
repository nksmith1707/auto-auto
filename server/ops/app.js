// Auto-Auto Ops Console: the staff website (prototypes/ops-console.html), running on live data.
// Plain JavaScript, no build step. Staff sign in with an admin account (npm run create-admin).
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (c) => (c == null ? "—" : `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const day = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const pill = (text, tone = "") => `<span class="pill ${tone}">${esc(text)}</span>`;

// ---------- Session and API ----------
let token = null;
try { token = sessionStorage.getItem("ops_token"); } catch { /* private mode */ }
const S = { v: "overview", tab: {}, me: null, q: "" };

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && token && path !== "/v1/auth/login") { signOutLocal(); throw new Error("Your session ended. Log in again."); }
  if (res.status >= 400) {
    const e = new Error((data && data.error && data.error.message) || "Something went wrong.");
    e.fields = data && data.error && data.error.fields;
    e.extra = data && data.error;
    throw e;
  }
  return data;
}
const errText = (e) => (e.fields ? Object.values(e.fields).filter(Boolean).join(" ") : "") || e.message;

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function signOutLocal() {
  token = null;
  try { sessionStorage.removeItem("ops_token"); } catch { /* ignore */ }
  showLogin();
}

// ---------- Log in ----------
function showLogin(msg) {
  $("#top").hidden = true;
  $("#shell").hidden = true;
  const box = $("#login");
  box.hidden = false;
  box.innerHTML = `<form class="login card" id="loginForm" novalidate>
    <div class="logo" style="color:var(--brand-deep)">Auto-Auto<span>OPS</span></div>
    <h1>Staff log in</h1>
    <div class="field"><label for="le">Email</label><input class="input" id="le" type="email" autocomplete="username" required></div>
    <div class="field"><label for="lp">Password</label><input class="input" id="lp" type="password" autocomplete="current-password" required></div>
    <div class="err" id="lerr" ${msg ? "" : "hidden"}>${esc(msg || "")}</div>
    <button class="btn primary" type="submit" id="lgo">Log in</button>
    <p class="muted" style="margin:0;font-size:12px">Staff accounts are made with <code>npm run create-admin</code> on the server.</p>
  </form>`;
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const err = $("#lerr");
    err.hidden = true;
    $("#lgo").disabled = true;
    try {
      const r = await api("POST", "/v1/auth/login", { email: $("#le").value, password: $("#lp").value });
      if (r.user.role !== "admin") {
        token = r.token;
        await api("POST", "/v1/auth/logout").catch(() => {});
        token = null;
        throw new Error("This isn't a staff account. Use the customer or partner app instead.");
      }
      token = r.token;
      try { sessionStorage.setItem("ops_token", token); } catch { /* ignore */ }
      start();
    } catch (ex) {
      err.textContent = errText(ex);
      err.hidden = false;
    } finally { $("#lgo").disabled = false; }
  };
}

async function start() {
  if (!token) return showLogin();
  try { S.me = (await api("GET", "/v1/me")).user; } catch { return showLogin(); }
  if (S.me.role !== "admin") { signOutLocal(); return; }
  $("#login").hidden = true;
  $("#top").hidden = false;
  $("#shell").hidden = false;
  $("#who").textContent = `${S.me.firstName} · Staff`;
  const hash = location.hash.slice(1);
  if (VIEWS.some((v) => v[0] === hash)) S.v = hash;
  render();
  // Badge counts for the sidebar.
  api("GET", "/v1/admin/overview").then((o) => { counts = countsOf(o); side(); }).catch(() => {});
}

// ---------- Layout ----------
const VIEWS = [["overview", "Overview"], ["jobs", "Jobs"], ["apps", "Applications"], ["partners", "Partners"], ["claims", "Claims & warranty"], ["ratings", "Ratings"], ["fleet", "Fleet & invoices"], ["incidents", "Incidents"], ["insurance", "Insurance"], ["payouts", "Payouts"], ["pricing", "Pricing & rules"]];
let counts = {};
const countsOf = (o) => ({ apps: o.applications, incidents: o.incidentsOpen, jobs: o.jobsLate + o.paymentProblems, insurance: o.insuranceExpired, payouts: o.payoutsFailed, fleet: o.fleetsInReview + o.fleetInvoicesPastDue, claims: o.claimsReady, ratings: o.lowRatings });

function side() {
  $("#side").innerHTML = VIEWS.map(([k, label]) => `<button data-v="${k}" ${S.v === k ? 'aria-current="page"' : ""}>${esc(label)}${counts[k] ? `<span class="cnt">${counts[k]}</span>` : ""}</button>`).join("");
  $$("#side [data-v]").forEach((b) => { b.onclick = () => go(b.dataset.v); });
}
function go(v, tab) {
  S.v = v;
  if (tab) S.tab[v] = tab;
  history.replaceState(null, "", `#${v}`);
  render();
  scrollTo(0, 0);
}
function tabs(key, list) {
  const cur = S.tab[key] || list[0][0];
  return `<div class="tabs" role="tablist">${list.map(([k, l]) => `<button role="tab" data-tab="${key}|${k}" aria-selected="${cur === k}">${esc(l)}</button>`).join("")}</div>`;
}
const tabOf = (key, def) => S.tab[key] || def;

// Only the latest render draws, so a slow page load can't overwrite a tab clicked after it.
let renderSeq = 0;
async function render() {
  const mine = ++renderSeq;
  side();
  const main = $("#main");
  main.innerHTML = `<div class="empty">Loading…</div>`;
  let html;
  try {
    html = await V[S.v]();
  } catch (e) {
    if (mine === renderSeq) main.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    return;
  }
  if (mine !== renderSeq) return;
  main.innerHTML = html;
  $$("[data-tab]", main).forEach((b) => { b.onclick = () => { const [k, t] = b.dataset.tab.split("|"); S.tab[k] = t; render(); }; });
  $$("[data-go]", main).forEach((b) => { b.onclick = () => { const [v, t] = b.dataset.go.split("|"); go(v, t); }; });
  if (BIND[S.v]) BIND[S.v](main);
  // Keep the sidebar counts current after anything staff do.
  if (S.v !== "overview") api("GET", "/v1/admin/overview").then((o) => { counts = countsOf(o); side(); }).catch(() => {});
}

function drawer(html, bind) {
  $("#layer").innerHTML = `<div class="drawer-bg"><div class="drawer" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg = $(".drawer-bg");
  bg.onclick = (e) => { if (e.target === bg || e.target.closest("[data-x]")) closeDrawer(); };
  if (bind) bind($(".drawer"));
}
const closeDrawer = () => { $("#layer").innerHTML = ""; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
const dh = (title, sub) => `<div class="dh"><div><h2>${esc(title)}</h2>${sub ? `<p class="muted" style="margin:4px 0 0">${sub}</p>` : ""}</div><button class="x" data-x aria-label="Close">×</button></div>`;

function thumbs(list) {
  if (!list || !list.length) return `<p class="muted" style="margin:0">None yet.</p>`;
  return `<div class="thumbs">${list.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(p.label)}" loading="lazy" class="${p.damageNote ? "dmg" : ""}"><small>${esc(p.label)}${p.damageNote ? " · damage" : ""}</small></a>`).join("")}</div>`;
}

const V = {};
const BIND = {};

// ---------- Overview ----------
V.overview = async () => {
  const o = await api("GET", "/v1/admin/overview");
  counts = countsOf(o);
  side();
  const att = [
    [o.applications, "brand", `${o.applications} application${o.applications === 1 ? "" : "s"} waiting for a decision`, "apps"],
    [o.jobsLate, "bad", `${o.jobsLate} job${o.jobsLate === 1 ? "" : "s"} where the partner hasn't left 30 minutes before the window`, "jobs|late"],
    [o.paymentProblems, "bad", `${o.paymentProblems} job${o.paymentProblems === 1 ? "" : "s"} with a declined card`, "jobs|payment"],
    [o.incidentsOpen, "warn", `${o.incidentsOpen} incident report${o.incidentsOpen === 1 ? "" : "s"} open`, "incidents"],
    [o.insuranceExpired, "bad", `${o.insuranceExpired} partner polic${o.insuranceExpired === 1 ? "y has" : "ies have"} expired (those partners can't take jobs)`, "insurance"],
    [o.insuranceExpiring, "warn", `${o.insuranceExpiring} polic${o.insuranceExpiring === 1 ? "y expires" : "ies expire"} within 30 days`, "insurance"],
    [o.partnersFlagged, "warn", `${o.partnersFlagged} partner${o.partnersFlagged === 1 ? "" : "s"} flagged for review (late cancels)`, "partners"],
    [o.fleetsInReview, "brand", `${o.fleetsInReview} business account${o.fleetsInReview === 1 ? "" : "s"} waiting for a credit check`, "fleet|accounts"],
    [o.fleetRunsWaiting, "bad", `${o.fleetRunsWaiting} fleet visit${o.fleetRunsWaiting === 1 ? "" : "s"} within 24 hours with no partner yet`, "fleet|runs"],
    [o.fleetInvoicesPastDue, "warn", `${o.fleetInvoicesPastDue} fleet invoice${o.fleetInvoicesPastDue === 1 ? "" : "s"} past due`, "fleet|invoices"],
    [o.payoutsFailed, "bad", `${o.payoutsFailed} payout${o.payoutsFailed === 1 ? "" : "s"} failed this week`, "payouts"],
    [o.docsToReview, "brand", `${o.docsToReview} document${o.docsToReview === 1 ? "" : "s"} from approved partners waiting for review (proof for new services or renewed insurance)`, "apps|all"],
    [o.claimsReady, "bad", `${o.claimsReady} damage claim${o.claimsReady === 1 ? " is" : "s are"} ready for a decision`, "claims|claims"],
    [o.claimsOpen - o.claimsReady, "warn", `${o.claimsOpen - o.claimsReady} claim${o.claimsOpen - o.claimsReady === 1 ? " is" : "s are"} waiting for the partner's response`, "claims|claims"],
    [o.warrantyOpen, "brand", `${o.warrantyOpen} warranty return${o.warrantyOpen === 1 ? "" : "s"} open`, "claims|warranty"],
    [o.lowRatings, "warn", `${o.lowRatings} low rating${o.lowRatings === 1 ? "" : "s"} (1–2 stars) need a follow-up within 1 business day`, "ratings"],
    [o.notifyFailures, "warn", `${o.notifyFailures} notification${o.notifyFailures === 1 ? "" : "s"} couldn't be delivered this week`, "overview"],
  ].filter((x) => x[0] > 0);
  const np = o.notifyProviders || {};
  return `<div class="ph"><div><h1>Today</h1><p>What needs attention first. Everything here is live.</p></div></div>
  <div class="kpis">
    <div class="kpi"><span>Jobs live now</span><b>${o.jobsLive}</b><small class="muted">on the way or working</small></div>
    <div class="kpi"><span>Waiting for a partner</span><b>${o.jobsWaiting}</b><small class="muted">requested or awaiting approval</small></div>
    <div class="kpi"><span>Completed today</span><b>${o.today.completed}</b><small class="muted">${money(o.today.chargedCents)} charged</small></div>
    <div class="kpi"><span>Active partners</span><b>${o.partnersActive}</b><small class="muted">${o.customers} customer${o.customers === 1 ? "" : "s"}</small></div>
  </div>
  <div class="card"><div class="card-h"><h2>Needs attention</h2></div>
    ${att.length ? `<div class="att">${att.map(([, tone, text, to]) => `<button data-go="${to}"><span class="sev ${tone}"></span><span class="grow">${esc(text)}</span><span class="muted">›</span></button>`).join("")}</div>`
      : `<p class="muted" style="margin:0">Nothing needs attention right now.</p>`}
  </div>
  <div class="card"><div class="card-h"><h2>Notifications</h2></div>
    <div class="kv"><span>Phone alerts</span><b>${np.push ? pill("On (Expo)", "ok") : pill("Off", "warn")}</b>
    <span>Texts</span><b>${np.sms ? pill(`Connected (${np.sms})`, "ok") : pill("Not connected", "warn")}</b>
    <span>Email</span><b>${np.email ? pill(`Connected (${np.email})`, "ok") : pill("Not connected", "warn")}</b></div>
    ${!np.sms || !np.email ? `<p class="muted" style="margin:0;font-size:12px">Until a provider is connected, those messages only show in the apps' inboxes. Add the keys in Render's Environment settings (see the README).</p>` : ""}
  </div>`;
};

// ---------- Jobs ----------
const JOB_STATUS = { requested: ["Finding partner", "brand"], awaiting_approval: ["Customer approving", "brand"], confirmed: ["Confirmed", ""], en_route: ["On the way", "warn"], arrived: ["Arrived", "warn"], in_progress: ["Working", "warn"], completed: ["Completed", "ok"], cancelled: ["Cancelled", ""], expired: ["No partner found", "bad"] };
const PAY_STATUS = { deposit_paid: ["Deposit paid", ""], held: ["Card held", ""], paid: ["Paid", "ok"], refunded: ["Refunded", ""], hold_failed: ["Hold declined", "bad"], charge_failed: ["Charge declined", "bad"] };

V.jobs = async () => {
  const f = tabOf("jobs", "open");
  const r = await api("GET", `/v1/admin/jobs?filter=${encodeURIComponent(f)}&q=${encodeURIComponent(S.q)}`);
  const rows = r.jobs.map((j) => `<tr class="click" data-job="${esc(j.id)}">
    <td>${esc(j.services.join(", "))}${j.late ? ` ${pill("Partner late", "bad")}` : ""}</td>
    <td>${j.kind === "scheduled" ? when(j.windowStart) : esc(j.kind === "asap" ? "ASAP" : "Roadside")}</td>
    <td>${esc(j.customer || "—")}</td><td>${esc(j.partner || "—")}</td>
    <td>${pill(...(JOB_STATUS[j.status] || [j.status]))}</td>
    <td>${j.paymentStatus ? pill(...(PAY_STATUS[j.paymentStatus] || [j.paymentStatus])) : ""}</td>
    <td class="r">${money(j.totalCents)}</td></tr>`).join("");
  return `<div class="ph"><div><h1>Jobs</h1><p>Every booking, live. Click one for the full record: timeline, photos, and payments.</p></div>
    <input class="input" id="jq" placeholder="Search customer, partner, or service" value="${esc(S.q)}" style="max-width:320px"></div>
  ${tabs("jobs", [["open", "Open"], ["live", "Live now"], ["waiting", "Waiting for partner"], ["late", "Partner late"], ["payment", "Card declined"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["all", "All"]])}
  <div class="tw"><table><thead><tr><th>Services</th><th>When</th><th>Customer</th><th>Partner</th><th>Status</th><th>Payment</th><th class="r">Total</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="7" class="empty">No jobs here.</td></tr>`}</tbody></table></div>`;
};
BIND.jobs = (main) => {
  const q = $("#jq", main);
  q.onkeydown = (e) => { if (e.key === "Enter") { S.q = q.value; render(); } };
  $$("[data-job]", main).forEach((tr) => { tr.onclick = () => openJob(tr.dataset.job); });
};

const EVENT = { claim_filed: "Damage claim filed", warranty_requested: "Warranty return requested", warranty_return_requested: "Customer asked for a warranty return", warranty_to_board: "Warranty return sent to all partners", warranty_declined: "Original partner can't do the warranty return", booked: "Booked", accepted: "Partner accepted", confirmed: "Confirmed", trip_started: "Partner on the way", arrived: "Partner arrived", checked_in: "Work started", completed: "Completed", cancelled: "Cancelled", expired: "No partner found", rescheduled: "Rescheduled", offer_sent: "Offer sent", offer_declined: "Partner passed", offer_expired: "Offer timed out", sent_to_all: "Sent to all partners", search_widened: "Search widened", no_show: "No-show", partner_cancelled: "Partner cancelled", partner_late_cancel: "Partner cancelled late", addons_requested: "Add-ons requested", addon_approved: "Add-on approved", addon_declined: "Add-on declined", glass_quote_sent: "Glass quote sent", glass_approved: "Glass approved", glass_declined: "Glass declined", incident_reported: "Incident reported", deposit_failed: "Deposit declined", partner_approved: "Customer approved partner", partner_declined_by_customer: "Customer declined partner", approval_timed_out: "Approval timed out", switched_partner: "Customer switched partner" };

async function openJob(id) {
  drawer(`${dh("Loading…")}`);
  let j;
  try { j = (await api("GET", `/v1/admin/jobs/${encodeURIComponent(id)}`)).job; } catch (e) { drawer(`${dh("Job")}<div class="note bad">${esc(e.message)}</div>`); return; }
  const pay = j.payment;
  const lines = (j.final ? j.final.lines : j.quote.lines) || [];
  drawer(`${dh(lines.map((l) => l.name).join(", ") || "Job", `${esc(j.vehicle.year)} ${esc(j.vehicle.make)} ${esc(j.vehicle.model)} · ${pill(...(JOB_STATUS[j.status] || [j.status]))}`)}
    <div class="kv">
      <span>Job</span><b class="num">${esc(j.id)}</b>
      <span>When</span><b>${j.kind === "scheduled" ? `${when(j.windowStart)} – ${new Date(j.windowEnd).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : esc(j.kind === "asap" ? "As soon as possible" : "Roadside")}</b>
      <span>Address</span><b>${esc(j.place.street)}${j.place.unit ? `, ${esc(j.place.unit)}` : ""}, ${esc(j.place.city)} ${esc(j.place.state)} ${esc(j.place.zip)}</b>
      <span>Customer</span><b>${esc(j.customer ? `${j.customer.name} · ${j.customer.email}${j.customer.phone ? ` · ${j.customer.phone}` : ""}` : "—")}</b>
      <span>Partner</span><b>${esc(j.partnerContact ? `${j.partnerContact.name} · ${j.partnerContact.email}${j.partnerContact.phone ? ` · ${j.partnerContact.phone}` : ""}` : "None yet")}</b>
      ${j.odometerIn != null ? `<span>Odometer</span><b class="num">${Number(j.odometerIn).toLocaleString("en-US")} mi</b>` : ""}
      ${j.notes ? `<span>Customer notes</span><b>${esc(j.notes)}</b>` : ""}
      ${j.workNotes ? `<span>Partner notes</span><b>${esc(j.workNotes)}</b>` : ""}
      ${j.cancelReason ? `<span>Cancel reason</span><b>${esc(j.cancelReason)}${j.cancelFeeCents ? ` · fee ${money(j.cancelFeeCents)}` : ""}</b>` : ""}
    </div>
    <div class="sec"><h3>Money</h3><div class="kv">
      <span>${j.final ? "Final total" : "Estimate"}</span><b class="num">${money(j.final ? j.final.chargeCents : j.quote.totalCents)}</b>
      ${j.partnerPay ? `<span>Partner earned</span><b class="num">${money(j.partnerPay.earningsCents)}${j.partnerPay.partsReimbursedCents ? ` + ${money(j.partnerPay.partsReimbursedCents)} parts` : ""}</b>` : ""}
      ${pay && pay.enabled ? `<span>Paid</span><b class="num">${money(pay.paidCents)}${pay.heldCents ? ` · ${money(pay.heldCents)} held` : ""}${pay.dueCents ? ` · <span style="color:var(--bad)">${money(pay.dueCents)} due</span>` : ""}</b>` : `<span>Payments</span><b>Off</b>`}
    </div>
    ${pay && pay.items.length ? `<div class="tw"><table><tbody>${pay.items.map((it) => `<tr><td>${esc(it.kind)}${it.card ? ` · ${esc(it.card)}` : ""}</td><td>${esc(it.status)}</td><td class="r">${money(it.status === "captured" ? it.capturedCents : it.amountCents)}</td><td class="muted">${when(it.at)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${pay && pay.problem ? `<div class="note bad">Card problem: ${esc(pay.problem)}</div>` : ""}</div>
    <div class="sec"><h3>Check-in photos</h3>${thumbs(j.allPhotos && j.allPhotos.checkin)}
      ${j.allPhotos && j.allPhotos.damage.length ? `<div class="note warn">Existing damage: ${j.allPhotos.damage.map((d) => `${esc(d.label)}: ${esc(d.note)}`).join("; ")}</div>` : ""}</div>
    <div class="sec"><h3>After photos</h3>${thumbs(j.allPhotos && j.allPhotos.after)}</div>
    ${j.incidents.length ? `<div class="sec"><h3>Incidents</h3>${j.incidents.map((i) => `<div class="note ${i.status === "open" ? "warn" : ""}"><b>${esc(i.typeLabel)}</b> · ${esc(i.status)} · ${when(i.createdAt)}<br>${esc(i.description)}</div>`).join("")}</div>` : ""}
    <div class="sec"><h3>Timeline</h3><div class="log">${j.timeline.map((e) => `<div><time>${when(e.at)}</time><span>${esc(EVENT[e.kind] || e.kind)}${e.note ? ` — ${esc(e.note)}` : ""}</span></div>`).join("")}</div></div>`);
}

// ---------- Applications ----------
const ID_STATUS = { not_started: ["Not started", ""], requires_input: ["Not finished", "warn"], processing: ["Checking", "brand"], verified: ["Verified", "ok"], canceled: ["Canceled", "warn"], failed: ["Failed", "bad"] };
const BG_STATUS = { not_started: ["Not authorized yet", ""], pending: ["Pending", "warn"], clear: ["Clear", "ok"], consider: ["Consider", "warn"], adverse: ["Adverse", "bad"] };
const P_STATUS = { applicant: ["Applying", ""], in_review: ["In review", "brand"], active: ["Active", "ok"], paused: ["Paused", "warn"], deactivated: ["Deactivated", "bad"] };
const DOC_STATUS = { pending: ["Needs review", "warn"], approved: ["Approved", "ok"], rejected: ["Rejected", "bad"] };

V.apps = async () => {
  const t = tabOf("apps", "review");
  const all = (await api("GET", "/v1/admin/applications")).applications;
  const list = all.filter((a) => (t === "review" ? a.status === "in_review" : t === "applying" ? a.status === "applicant" : true));
  return `<div class="ph"><div><h1>Applications</h1><p>Review submitted partner applications: ID, background check, documents, and signatures.</p></div></div>
  ${tabs("apps", [["review", `In review (${all.filter((a) => a.status === "in_review").length})`], ["applying", "Still applying"], ["all", "All partners"]])}
  <div class="tw"><table><thead><tr><th>Partner</th><th>Status</th><th>Submitted</th><th>ID check</th><th>Background</th></tr></thead><tbody>
  ${list.map((a) => `<tr class="click" data-app="${esc(a.id)}"><td><b>${esc(a.name)}</b><br><span class="muted">${esc(a.email)}</span></td><td>${pill(...P_STATUS[a.status])}</td><td>${a.submittedAt ? when(a.submittedAt) : "—"}</td><td>${pill(...(ID_STATUS[a.identity] || [a.identity]))}</td><td>${pill(...(BG_STATUS[a.background] || [a.background]))}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No applications here.</td></tr>`}
  </tbody></table></div>`;
};
BIND.apps = (main) => { $$("[data-app]", main).forEach((tr) => { tr.onclick = () => openApp(tr.dataset.app); }); };

async function openFile(id) {
  const res = await fetch(`/v1/admin/documents/${encodeURIComponent(id)}/file`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { toast("Couldn't open that document."); return; }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function openApp(id) {
  drawer(dh("Loading…"));
  let a;
  try { a = await api("GET", `/v1/admin/applications/${encodeURIComponent(id)}`); } catch (e) { drawer(`${dh("Application")}<div class="note bad">${esc(e.message)}</div>`); return; }
  const legal = [a.legalName.first, a.legalName.middle, a.legalName.last].filter(Boolean).join(" ");
  const ins = (a.answers.insurance || {}).coverage;
  drawer(`${dh(a.partner.name, `${esc(a.partner.email)} · ${esc(a.partner.phone || "")} · ${pill(...P_STATUS[a.status])}`)}
    ${a.decision === "return" && a.decisionNote ? `<div class="note warn">Sent back: ${esc(a.decisionNote)}</div>` : ""}
    <div class="kv">
      <span>Legal name</span><b>${esc(legal || "—")}</b>
      <span>Submitted</span><b>${a.submittedAt ? when(a.submittedAt) : "Not yet"}</b>
      <span>Coverage</span><b>${esc({ aa: "Partner Protection", split: "Own liability + Auto-Auto garagekeepers", own: "Own insurance (opted out)" }[ins] || "—")}</b>
      <span>Services</span><b>${esc((a.servicesOffered || []).join(", ") || "—")}</b>
      <span>Payouts</span><b>${a.payouts.detailsSubmitted ? "Set up" : "Not set up"}</b>
      <span>Arbitration</span><b>${a.arbitration.optedOutAt ? `Opted out ${day(a.arbitration.optedOutAt)}` : "Agreed"}</b>
    </div>
    <div class="sec"><h3>Checklist</h3><div class="checks">${a.steps.map((s) => `<div><span>${esc(s.title)}${s.done ? "" : `<br><span class="muted" style="font-size:12px">${esc(s.errors.join("; "))}</span>`}</span>${s.done ? pill("Done", "ok") : pill("Missing", "warn")}</div>`).join("")}</div></div>
    <div class="sec"><h3>ID check</h3><div class="row">${pill(...(ID_STATUS[a.identity.status] || [a.identity.status]))}${a.identity.over21 === false ? pill("Under 21", "bad") : a.identity.over21 ? pill("21 or older", "ok") : ""}
      ${a.identity.status !== "verified" ? `<button class="btn" data-idv="yes">Mark verified (21+)</button>` : ""}</div>
      ${!a.identity.enabled ? `<p class="muted" style="margin:0;font-size:12px">Stripe Identity is off, so check the ID yourself.</p>` : ""}</div>
    <div class="sec"><h3>Background check</h3><div class="row">${pill(...(BG_STATUS[a.background.status] || [a.background.status]))}${a.background.note ? `<span class="muted">${esc(a.background.note)}</span>` : ""}</div>
      <div class="row"><input class="input" id="bgnote" placeholder="Note (vendor report number)" style="flex:1;min-width:180px">
      ${["pending", "clear", "consider", "adverse"].map((st) => `<button class="btn ${st === "clear" ? "ok" : st === "adverse" ? "danger" : ""}" data-bg="${st}">${esc(BG_STATUS[st][0])}</button>`).join("")}</div>
      <p class="muted" style="margin:0;font-size:12px">No background-check vendor is connected yet. Record the result from the vendor's report. Before "Adverse", send the pre-adverse notice and wait 5 business days (FCRA).</p></div>
    <div class="sec"><h3>Documents</h3>${a.documents.length ? `<div class="checks">${a.documents.map((d) => `<div><span><b>${esc(d.label)}</b><br><span class="muted" style="font-size:12px">${esc(d.filename)} · ${when(d.uploadedAt)}${d.reviewNote ? ` · ${esc(d.reviewNote)}` : ""}</span></span>
        <span class="row">${pill(...DOC_STATUS[d.status])}<button class="btn" data-file="${esc(d.id)}">View</button>${d.status !== "approved" ? `<button class="btn ok" data-doc="${esc(d.id)}|approved">Approve</button>` : ""}${d.status !== "rejected" ? `<button class="btn" data-doc="${esc(d.id)}|rejected">Reject</button>` : ""}</span></div>`).join("")}</div>
        <input class="input" id="docnote" placeholder="Reason, if rejecting (the partner sees it)">` : `<p class="muted" style="margin:0">No uploads.</p>`}</div>
    <div class="sec"><h3>Signatures</h3>${Object.keys(a.signatures).length ? `<div class="tw"><table><thead><tr><th>Document</th><th>Signed as</th><th>When</th><th>From</th></tr></thead><tbody>${Object.entries(a.signatures).map(([k, s]) => `<tr><td>${esc(k)} v${esc(s.version)}</td><td>${esc(s.name || "(acknowledged)")}</td><td>${when(s.signedAt)}</td><td class="muted">${esc(s.ip || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted" style="margin:0">Nothing signed yet.</p>`}</div>
    <div class="sec"><h3>Decision</h3>
      <textarea class="input" id="dnote" placeholder="Note for the partner (required to send back or deny)"></textarea>
      <div class="err" id="derr" hidden></div>
      <div class="btns"><button class="btn ok" data-dec="approve" ${a.status === "in_review" ? "" : "disabled"}>Approve</button><button class="btn" data-dec="return">Send back to fix</button><button class="btn danger" data-dec="deny">Deny</button></div>
    </div>`, (d) => {
    const refresh = () => { openApp(id); if (S.v === "apps" || S.v === "overview") render(); };
    $$("[data-file]", d).forEach((b) => { b.onclick = () => openFile(b.dataset.file); });
    $$("[data-doc]", d).forEach((b) => {
      b.onclick = async () => {
        const [docId, status] = b.dataset.doc.split("|");
        try { await api("POST", `/v1/admin/documents/${encodeURIComponent(docId)}/review`, { status, note: $("#docnote", d) ? $("#docnote", d).value : "" }); toast(status === "approved" ? "Document approved" : "Document rejected"); refresh(); } catch (e) { toast(errText(e)); }
      };
    });
    $$("[data-bg]", d).forEach((b) => {
      b.onclick = async () => {
        try { await api("POST", `/v1/admin/applications/${encodeURIComponent(id)}/background`, { status: b.dataset.bg, note: $("#bgnote", d).value }); toast("Background check updated"); refresh(); } catch (e) { toast(errText(e)); }
      };
    });
    const idv = $("[data-idv]", d);
    if (idv) idv.onclick = async () => { try { await api("POST", `/v1/admin/applications/${encodeURIComponent(id)}/identity`, { status: "verified", over21: true }); toast("ID marked verified"); refresh(); } catch (e) { toast(errText(e)); } };
    $$("[data-dec]", d).forEach((b) => {
      b.onclick = async () => {
        const err = $("#derr", d);
        err.hidden = true;
        try {
          await api("POST", `/v1/admin/applications/${encodeURIComponent(id)}/decision`, { decision: b.dataset.dec, note: $("#dnote", d).value });
          toast({ approve: "Partner approved", return: "Sent back to the partner", deny: "Application denied" }[b.dataset.dec]);
          refresh();
        } catch (e) {
          err.innerHTML = e.extra && e.extra.blockers ? `Can't approve yet:<br>• ${e.extra.blockers.map(esc).join("<br>• ")}` : esc(errText(e));
          err.hidden = false;
        }
      };
    });
  });
}

// ---------- Partners ----------
V.partners = async () => {
  const t = tabOf("partners", "active");
  const all = (await api("GET", "/v1/admin/partners")).partners;
  const list = all.filter((p) => (t === "flagged" ? p.reviewReason : t === "all" ? true : p.status === t));
  return `<div class="ph"><div><h1>Partners</h1><p>Pause or reactivate partners. Flags come from late cancels (3 in 30 days).</p></div></div>
  ${tabs("partners", [["active", "Active"], ["flagged", `Flagged (${all.filter((p) => p.reviewReason).length})`], ["paused", "Paused"], ["deactivated", "Deactivated"], ["all", "All"]])}
  <div class="tw"><table><thead><tr><th>Partner</th><th>Status</th><th>Area</th><th class="r">Jobs done</th><th class="r">Late cancels (30 days)</th><th>Joined</th></tr></thead><tbody>
  ${list.map((p) => `<tr class="click" data-partner="${esc(p.id)}"><td><b>${esc(p.name)}</b><br><span class="muted">${esc(p.email)}</span></td><td>${pill(...P_STATUS[p.status])}${p.reviewReason ? ` ${pill(p.reviewReason, "warn")}` : ""}</td><td>${esc(p.area || "—")}</td><td class="r">${p.jobsDone}</td><td class="r">${p.lateCancels30d}</td><td>${day(p.createdAt)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No partners here.</td></tr>`}
  </tbody></table></div>`;
};
BIND.partners = async (main) => {
  const all = (await api("GET", "/v1/admin/partners")).partners;
  $$("[data-partner]", main).forEach((tr) => {
    tr.onclick = () => {
      const p = all.find((x) => x.id === tr.dataset.partner);
      drawer(`${dh(p.name, `${esc(p.email)} · ${esc(p.phone || "")}`)}
        <div class="kv"><span>Status</span><b>${pill(...P_STATUS[p.status])}</b>${p.statusReason ? `<span>Reason</span><b>${esc(p.statusReason)}</b>` : ""}${p.reviewReason ? `<span>Flag</span><b>${esc(p.reviewReason)}</b>` : ""}
        <span>Area</span><b>${esc(p.area || "—")}</b><span>Jobs done</span><b>${p.jobsDone}</b><span>Late cancels (30 days)</span><b>${p.lateCancels30d}</b></div>
        <div class="sec"><h3>Change status</h3><textarea class="input" id="preason" placeholder="Reason (required to pause or deactivate; the partner sees it)"></textarea>
        <div class="err" id="perr" hidden></div>
        <div class="btns">${p.status !== "active" && p.status !== "applicant" && p.status !== "in_review" ? `<button class="btn ok" data-ps="active">Reactivate</button>` : ""}${p.status === "active" ? `<button class="btn" data-ps="paused">Pause</button>` : ""}${p.status !== "deactivated" ? `<button class="btn danger" data-ps="deactivated">Deactivate</button>` : ""}
        <button class="btn" data-openapp>Open application</button></div></div>`, (d) => {
        $$("[data-ps]", d).forEach((b) => {
          b.onclick = async () => {
            try { await api("POST", `/v1/admin/partners/${encodeURIComponent(p.id)}/status`, { status: b.dataset.ps, reason: $("#preason", d).value }); toast("Status updated"); closeDrawer(); render(); }
            catch (e) { const er = $("#perr", d); er.textContent = errText(e); er.hidden = false; }
          };
        });
        $("[data-openapp]", d).onclick = () => openApp(p.id);
      });
    };
  });
};

// ---------- Incidents ----------
V.incidents = async () => {
  const t = tabOf("incidents", "open");
  const list = (await api("GET", `/v1/admin/incidents?status=${t === "all" ? "" : t}`)).incidents;
  return `<div class="ph"><div><h1>Incidents</h1><p>Partner reports of damage, injuries, unsafe situations, and customer behavior. Respond within 1 business day.</p></div></div>
  ${tabs("incidents", [["open", "Open"], ["closed", "Closed"], ["all", "All"]])}
  <div class="tw"><table><thead><tr><th>What happened</th><th>Reported by</th><th>When</th><th>Photos</th><th>Status</th></tr></thead><tbody>
  ${list.map((i) => `<tr class="click" data-inc="${esc(i.id)}"><td><b>${esc(i.typeLabel)}</b><br><span class="muted">${esc(i.description.slice(0, 90))}${i.description.length > 90 ? "…" : ""}</span></td><td>${esc(i.reporter || "—")}</td><td>${when(i.createdAt)}</td><td>${i.photos.length}</td><td>${pill(i.status === "open" ? "Open" : "Closed", i.status === "open" ? "warn" : "ok")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No reports here.</td></tr>`}
  </tbody></table></div>`;
};
BIND.incidents = async (main) => {
  const t = tabOf("incidents", "open");
  const list = (await api("GET", `/v1/admin/incidents?status=${t === "all" ? "" : t}`)).incidents;
  $$("[data-inc]", main).forEach((tr) => {
    tr.onclick = () => {
      const i = list.find((x) => x.id === tr.dataset.inc);
      drawer(`${dh(i.typeLabel, `${esc(i.reporter || "")} · ${when(i.createdAt)}`)}
        <div class="note">${esc(i.description)}</div>
        <div class="sec"><h3>Photos</h3>${thumbs(i.photos)}</div>
        ${i.jobId ? `<button class="btn" data-openjob="${esc(i.jobId)}">Open the job</button>` : ""}
        ${i.status === "open" ? `<div class="sec"><h3>Close</h3><textarea class="input" id="inote" placeholder="How it was resolved"></textarea><div class="err" id="ierr" hidden></div><button class="btn primary" data-close>Close report</button></div>`
          : `<div class="note ok">Closed: ${esc(i.staffNote || "")}</div>`}`, (d) => {
        const oj = $("[data-openjob]", d);
        if (oj) oj.onclick = () => openJob(oj.dataset.openjob);
        const c = $("[data-close]", d);
        if (c) c.onclick = async () => {
          try { await api("POST", `/v1/admin/incidents/${encodeURIComponent(i.id)}/close`, { note: $("#inote", d).value }); toast("Report closed"); closeDrawer(); render(); }
          catch (e) { const er = $("#ierr", d); er.textContent = errText(e); er.hidden = false; }
        };
      });
    };
  });
};

// ---------- Insurance ----------
V.insurance = async () => {
  const list = (await api("GET", "/v1/admin/insurance")).policies;
  const tone = (d) => (d == null ? "" : d < 0 ? "bad" : d < 30 ? "warn" : "ok");
  return `<div class="ph"><div><h1>Insurance</h1><p>Every partner policy with its expiration. Partners can't take jobs while a required policy is expired.</p></div></div>
  <div class="tw"><table><thead><tr><th>Partner</th><th>Policy</th><th>Carrier · number</th><th>Expires</th><th>Certificate</th></tr></thead><tbody>
  ${list.map((x) => `<tr><td><b>${esc(x.partner)}</b><br><span class="muted">${esc(x.email)}</span></td><td>${esc(x.label)}</td><td>${esc(x.carrier || "—")} · ${esc(x.policyNumber || "—")}</td>
    <td>${x.expires ? pill(`${x.expires}${x.daysLeft < 0 ? " · expired" : x.daysLeft < 30 ? ` · ${x.daysLeft} days` : ""}`, tone(x.daysLeft)) : pill("Missing", "bad")}</td>
    <td>${pill(...({ approved: ["Approved", "ok"], pending: ["Needs review", "warn"], rejected: ["Rejected", "bad"], missing: ["Not uploaded", "bad"] }[x.document]))}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No policies on file yet.</td></tr>`}
  </tbody></table></div>`;
};

// ---------- Payouts ----------
V.payouts = async () => {
  const r = await api("GET", "/v1/admin/payouts");
  return `<div class="ph"><div><h1>Payouts</h1><p>Partner balances and payouts. Daily at 9 PM Eastern after 10 jobs; weekly on Mondays before that.</p></div></div>
  ${r.enabled ? "" : `<div class="note warn">Payments are off on this server (no Stripe key). Earnings are still recorded.</div>`}
  <div class="card"><div class="card-h"><h2>Balances</h2></div><div class="tw"><table><thead><tr><th>Partner</th><th>Schedule</th><th class="r">Available</th><th class="r">Reserve</th><th class="r">Held (claims)</th><th class="r">Owes</th><th>Last payout</th><th>Payouts</th></tr></thead><tbody>
  ${r.partners.map((p) => `<tr><td><b>${esc(p.partner)}</b><br><span class="muted">${esc(p.email)}</span></td><td>${esc(p.schedule)} · ${p.jobsDone} jobs</td><td class="r">${money(p.availableCents)}</td><td class="r">${money(p.reserveCents)}</td><td class="r">${p.heldCents ? money(p.heldCents) : "—"}</td><td class="r">${p.owedCents ? money(p.owedCents) : "—"}</td><td>${p.lastPayout ? `${money(p.lastPayout.amountCents)} · ${when(p.lastPayout.at)}` : "—"}</td><td>${p.payoutsEnabled ? pill("On", "ok") : pill("Setup unfinished", "warn")}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No partners have set up payouts yet.</td></tr>`}
  </tbody></table></div></div>
  <div class="card"><div class="card-h"><h2>Recent payouts</h2></div><div class="tw"><table><thead><tr><th>Partner</th><th>Kind</th><th class="r">Amount</th><th class="r">Fee</th><th>Status</th><th>When</th></tr></thead><tbody>
  ${r.payouts.map((p) => `<tr><td>${esc(p.partner)}</td><td>${esc(p.kind)}</td><td class="r">${money(p.amountCents)}</td><td class="r">${money(p.feeCents)}</td><td>${p.status === "paid" ? pill("Paid", "ok") : pill(`Failed${p.error ? `: ${p.error}` : ""}`, "bad")}</td><td>${when(p.at)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No payouts yet.</td></tr>`}
  </tbody></table></div></div>`;
};

// ---------- Fleet & invoices ----------
const F_STATUS = { review: ["Credit check", "brand"], active: ["Active", "ok"], declined: ["Declined", "bad"], paused: ["Paused", "warn"] };
const R_STATUS = { posted: ["Looking for partner", "brand"], claimed: ["Claimed", ""], active: ["In progress", "warn"], completed: ["Completed", "ok"], cancelled: ["Cancelled", ""] };
V.fleet = async () => {
  const t = tabOf("fleet", "accounts");
  const head = `<div class="ph"><div><h1>Fleet & invoices</h1><p>Business accounts (net 30 needs a credit check), their visits, and invoices. Partners are paid whether or not a fleet has paid.</p></div></div>
  ${tabs("fleet", [["accounts", "Accounts"], ["invoices", "Open invoices"], ["paid", "Paid invoices"], ["runs", "Visits"]])}`;
  if (t === "accounts") {
    const list = (await api("GET", "/v1/admin/fleets")).fleets;
    return `${head}<div class="tw"><table><thead><tr><th>Fleet</th><th>Status</th><th>Terms</th><th class="r">Vehicles</th><th class="r">Open</th><th class="r">Past due</th></tr></thead><tbody>
    ${list.map((f) => `<tr class="click" data-fleet="${esc(f.id)}"><td><b>${esc(f.name)}</b><br><span class="muted">${esc(f.managerName)} · ${esc(f.ownerEmail)}</span></td><td>${pill(...F_STATUS[f.status])}</td><td>${f.terms === "net30" ? `Net 30 · ${money(f.creditLimitCents)} limit` : "Card on file"}</td><td class="r">${f.vehicles}</td><td class="r">${money(f.openInvoicesCents)}</td><td class="r">${f.pastDueCents ? `<span style="color:var(--bad)">${money(f.pastDueCents)}</span>` : "—"}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No business accounts yet.</td></tr>`}
    </tbody></table></div>`;
  }
  if (t === "runs") {
    const runs = (await api("GET", "/v1/admin/fleet-runs")).runs;
    return `${head}<div class="tw"><table><thead><tr><th>Visit</th><th>Fleet</th><th>When</th><th>Partner</th><th>Status</th><th class="r">Estimate</th></tr></thead><tbody>
    ${runs.map((r) => `<tr class="click" data-frun="${esc(r.id)}"><td>#${r.number} · ${r.vehicles.length} vehicles</td><td>${esc(r.fleet.name)}</td><td>${when(r.windowStart)}</td><td>${esc(r.partner ? r.partner.name : "—")}</td><td>${pill(...R_STATUS[r.status])}</td><td class="r">${money(r.invoice ? r.invoice.totalCents : r.estimateCents)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No fleet visits yet.</td></tr>`}
    </tbody></table></div>`;
  }
  const inv = (await api("GET", `/v1/admin/fleet-invoices?status=${t === "paid" ? "paid" : "open"}`)).invoices;
  return `${head}<div class="tw"><table><thead><tr><th>Invoice</th><th>Fleet</th><th>Issued</th><th>Due</th><th class="r">Total</th><th>Status</th><th></th></tr></thead><tbody>
  ${inv.map((i) => `<tr><td>INV-${i.number}${i.po ? `<br><span class="muted">${esc(i.po)}</span>` : ""}</td><td>${esc(i.fleet)}</td><td>${day(i.issuedAt)}</td><td>${day(i.dueAt)}</td><td class="r">${money(i.totalCents)}</td>
    <td>${i.status === "paid" ? pill("Paid", "ok") : i.pastDue ? pill("Past due", "bad") : pill("Open", "warn")}${i.paidNote ? `<br><span class="muted">${esc(i.paidNote)}</span>` : ""}${i.paymentError && i.status === "open" ? `<br><span class="muted">${esc(i.paymentError)}</span>` : ""}</td>
    <td>${i.status === "open" ? `<button class="btn" data-markpaid="${esc(i.id)}">Mark paid</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No invoices here.</td></tr>`}
  </tbody></table></div>`;
};
BIND.fleet = async (main) => {
  $$("[data-markpaid]", main).forEach((b) => {
    b.onclick = () => drawer(`${dh("Mark invoice paid")}<div class="field"><label for="pnote">How it was paid</label><input class="input" id="pnote" placeholder="Check #4471, or ACH reference"></div><div class="err" id="perr3" hidden></div><button class="btn primary" id="pgo">Mark paid</button>`, (d) => {
      $("#pgo", d).onclick = async () => {
        try { await api("POST", `/v1/admin/fleet-invoices/${encodeURIComponent(b.dataset.markpaid)}/paid`, { note: $("#pnote", d).value }); toast("Invoice marked paid"); closeDrawer(); render(); }
        catch (e) { const er = $("#perr3", d); er.textContent = errText(e); er.hidden = false; }
      };
    });
  });
  $$("[data-frun]", main).forEach((tr) => {
    tr.onclick = async () => {
      drawer(dh("Loading…"));
      const r = (await api("GET", `/v1/admin/fleet-runs/${encodeURIComponent(tr.dataset.frun)}`)).run;
      drawer(`${dh(`Fleet visit #${r.number}`, `${esc(r.fleet.name)} · ${pill(...R_STATUS[r.status])}`)}
        <div class="kv"><span>When</span><b>${when(r.windowStart)}</b><span>Yard</span><b>${esc(r.fleet.yard.street)}, ${esc(r.fleet.yard.city)}</b><span>Partner</span><b>${esc(r.partner ? r.partner.name : "—")}</b><span>PO</span><b>${esc(r.po || "—")}</b>
        <span>${r.invoice ? "Invoice" : "Estimate"}</span><b>${r.invoice ? `INV-${r.invoice.number} · ${money(r.invoice.totalCents)} · ${esc(r.invoice.status)}` : money(r.estimateCents)}</b></div>
        ${r.vehicles.map((v) => `<div class="sec"><h3>${esc(v.unit)} · ${esc(v.year)} ${esc(v.make)} ${esc(v.model)} ${pill(v.status)}</h3>
          <div class="muted">${esc(v.lines.map((l) => l.name).join(", "))}${v.addons.length ? ` · add-ons: ${esc(v.addons.map((a) => `${a.name} (${a.status})`).join(", "))}` : ""}${v.odometer != null ? ` · ${Number(v.odometer).toLocaleString("en-US")} mi` : ""}</div>
          ${v.notes ? `<div class="note">${esc(v.notes)}</div>` : ""}${v.skipReason ? `<div class="note warn">Not serviced: ${esc(v.skipReason)}</div>` : ""}
          ${v.photos && (v.photos.checkin.length || v.photos.after.length) ? thumbs([...v.photos.checkin, ...v.photos.after]) : ""}</div>`).join("")}`);
    };
  });
  const list = $$("[data-fleet]", main).length ? (await api("GET", "/v1/admin/fleets")).fleets : [];
  $$("[data-fleet]", main).forEach((tr) => {
    tr.onclick = () => {
      const f = list.find((x) => x.id === tr.dataset.fleet);
      drawer(`${dh(f.name, `${esc(f.managerName)} · ${esc(f.ownerEmail)} · ${pill(...F_STATUS[f.status])}`)}
        <div class="kv"><span>Terms</span><b>${f.terms === "net30" ? "Net 30" : "Card on file"}</b><span>Credit limit</span><b>${money(f.creditLimitCents)}</b><span>Labor rate</span><b>$${esc(f.laborRate)}/hr</b>
        <span>Open invoices</span><b>${money(f.openInvoicesCents)}${f.pastDueCents ? ` · ${money(f.pastDueCents)} past due` : ""}</b><span>Vehicles</span><b>${f.vehicles}</b>
        <span>Yard</span><b>${esc(f.yard.street)}, ${esc(f.yard.city)} ${esc(f.yard.state)} ${esc(f.yard.zip)}</b><span>Billing</span><b>${esc(f.billingEmail)}</b><span>Applied</span><b>${day(f.createdAt)}</b></div>
        ${f.decisionNote ? `<div class="note">${esc(f.decisionNote)}</div>` : ""}
        <div class="sec"><h3>Terms and decision</h3>
          <div class="row"><div class="field" style="flex:1"><label for="fcl">Credit limit ($)</label><input class="input num" id="fcl" type="number" min="0" value="${f.creditLimitCents / 100}"></div>
          <div class="field" style="flex:1"><label for="flr">Labor rate ($/hr)</label><input class="input num" id="flr" type="number" min="1" value="${esc(f.laborRate)}"></div></div>
          <textarea class="input" id="fnote" placeholder="Note (required to decline or pause; the fleet manager sees it)"></textarea>
          <div class="err" id="ferr" hidden></div>
          <div class="btns">${f.status !== "active" ? `<button class="btn ok" data-fdec="${f.status === "review" ? "approve" : "reactivate"}">${f.status === "review" ? "Approve" : "Reactivate"}</button>` : `<button class="btn" data-fdec="update">Save terms</button>`}
          ${f.status === "review" ? `<button class="btn danger" data-fdec="decline">Decline</button>` : ""}${f.status === "active" ? `<button class="btn" data-fdec="pause">Pause</button>` : ""}</div>
          <p class="muted" style="margin:0;font-size:12px">Net 30: run a business credit check before approving, and set the limit from it.</p></div>`, (d) => {
        $$("[data-fdec]", d).forEach((b) => {
          b.onclick = async () => {
            try {
              await api("POST", `/v1/admin/fleets/${encodeURIComponent(f.id)}/decision`, { decision: b.dataset.fdec, creditLimitCents: Math.round(Number($("#fcl", d).value) * 100), laborRate: Number($("#flr", d).value), note: $("#fnote", d).value });
              toast("Fleet account updated"); closeDrawer(); render();
            } catch (e) { const er = $("#ferr", d); er.textContent = errText(e); er.hidden = false; }
          };
        });
      });
    };
  });
};

// ---------- Claims & warranty ----------
const C_STATUS = { partner: ["Waiting on partner · 48h", "warn"], review: ["Ready to decide", "brand"], closed: ["Decided", "ok"] };
const PAID_BY = { protection: "Partner Protection (partner pays the deductible from payouts, max 25% of each)", own_insurer: "Partner's own insurer (Auto-Auto files on their policy)", auto_auto: "Auto-Auto pays now, recovers from partner payouts" };
V.claims = async () => {
  const t = tabOf("claims", "claims");
  const head = `<div class="ph"><div><h1>Claims & warranty</h1><p>Compare the partner's check-in photos with the customer's. Partners get 48 hours to respond before a decision. An open claim holds only that job's pay.</p></div></div>
  ${tabs("claims", [["claims", "Open claims"], ["closed", "Decided"], ["warranty", "Warranty returns"], ["owed", "Owed by partners"]])}`;
  if (t === "warranty") {
    const list = (await api("GET", "/v1/admin/warranty")).returns;
    return `${head}<div class="tw"><table><thead><tr><th>Customer</th><th>Original job</th><th>Issue</th><th>Original partner</th><th>Return visit</th><th>Charge back</th></tr></thead><tbody>
    ${list.map((w) => `<tr><td>${esc(w.customer)}</td><td>${esc(w.originalServices.join(", "))}<br><span class="muted">${day(w.originalDoneAt)}</span></td><td>${esc({ same_problem: "Same problem is back", new_noise: "New noise or leak", warning_light: "Warning light", loose_missing: "Loose or missing part" }[w.issue] || w.issue)}${w.details ? `<br><span class="muted">${esc(w.details)}</span>` : ""}</td>
      <td>${esc(w.originalPartner)}</td><td>${pill(...(JOB_STATUS[w.status] || [w.status]))}<br><span class="muted">${w.returnPartner ? esc(w.returnPartner) : "No partner yet"} · ${when(w.windowStart)}</span> <button class="btn" data-openjob="${esc(w.returnJobId)}">Open</button></td>
      <td>${w.samePartner ? `<span class="muted">Same partner · no charge</span>` : `<label><input type="checkbox" data-cb="${esc(w.id)}" ${w.chargeBack ? "checked" : ""}> Bill original partner${w.debt ? ` (${money(w.debt.cents)})` : ""}</label>`}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No warranty returns yet.</td></tr>`}
    </tbody></table></div><p class="muted" style="margin:0;font-size:13px">When the original partner can't return, another partner does the work and it's charged back to the original partner's payouts, unless you untick it.</p>`;
  }
  if (t === "owed") {
    const list = (await api("GET", "/v1/admin/debts")).debts;
    return `${head}<div class="tw"><table><thead><tr><th>Partner</th><th>For</th><th class="r">Amount</th><th class="r">Recovered</th><th class="r">Still owed</th><th>Since</th><th></th></tr></thead><tbody>
    ${list.map((d) => `<tr><td>${esc(d.partner)}</td><td>${esc(d.reason)}</td><td class="r">${money(d.cents)}</td><td class="r">${money(d.recoveredCents)}</td><td class="r">${d.waived ? pill("Waived") : money(d.owedCents)}</td><td>${day(d.at)}</td>
      <td>${d.owedCents || d.waived ? `<button class="btn" data-waive="${esc(d.id)}|${d.waived ? "0" : "1"}">${d.waived ? "Undo waive" : "Waive"}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No partner owes anything.</td></tr>`}
    </tbody></table></div><p class="muted" style="margin:0;font-size:13px">Recovered from payouts, oldest first, never more than 25% of any one payout.</p>`;
  }
  const list = (await api("GET", `/v1/admin/claims?status=${t === "closed" ? "closed" : "open"}`)).claims;
  return `${head}<div class="tw"><table><thead><tr><th>Claim</th><th>Filed</th><th>Customer</th><th>Partner</th><th>Damage to</th><th class="r">Estimate</th><th>Coverage</th><th>Status</th></tr></thead><tbody>
  ${list.map((c) => `<tr class="click" data-claim="${esc(c.id)}"><td class="num"><b>${esc(c.number)}</b></td><td>${when(c.createdAt)}</td><td>${esc(c.customer)}</td><td>${esc(c.partner)}</td><td>${esc(c.damageTo)}</td><td class="r">${money(c.estimateCents)}</td><td>${esc(c.coverage)}</td>
    <td>${c.status === "closed" ? pill(`${c.outcome}${c.amountCents ? ` · ${money(c.amountCents)}` : ""}`, c.outcome === "Denied" ? "" : "ok") : pill(...C_STATUS[c.status])}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No claims here.</td></tr>`}
  </tbody></table></div>`;
};
BIND.claims = (main) => {
  $$("[data-claim]", main).forEach((tr) => { tr.onclick = () => openClaim(tr.dataset.claim); });
  $$("[data-openjob]", main).forEach((b) => { b.onclick = () => openJob(b.dataset.openjob); });
  $$("[data-cb]", main).forEach((c) => {
    c.onchange = async () => {
      try { await api("POST", `/v1/admin/warranty/${encodeURIComponent(c.dataset.cb)}/charge-back`, { chargeBack: c.checked }); toast(c.checked ? "Original partner will be billed" : "Charge-back waived"); render(); } catch (e) { toast(errText(e)); c.checked = !c.checked; }
    };
  });
  $$("[data-waive]", main).forEach((b) => {
    b.onclick = async () => {
      const [id, w] = b.dataset.waive.split("|");
      try { await api("POST", `/v1/admin/debts/${encodeURIComponent(id)}/waive`, { waive: w === "1" }); toast(w === "1" ? "Waived" : "Owed again"); render(); } catch (e) { toast(errText(e)); }
    };
  });
};

async function openClaim(id) {
  drawer(dh("Loading…"));
  let c;
  try { c = (await api("GET", `/v1/admin/claims/${encodeURIComponent(id)}`)).claim; } catch (e) { drawer(`${dh("Claim")}<div class="note bad">${esc(e.message)}</div>`); return; }
  const jp = c.jobPhotos || { checkin: [], after: [], damage: [] };
  drawer(`${dh(`${c.number} · ${c.damageToLabel}`, `Filed ${when(c.createdAt)} · ${c.status === "closed" ? pill("Decided", "ok") : pill(...C_STATUS[c.status])}`)}
    <div class="kv"><span>Job</span><b>${esc(c.job.services.join(", "))} · ${day(c.job.completedAt)}</b>
    <span>Customer</span><b>${esc(c.customerName)} · ${esc(c.customerContact.email)}${c.customerContact.phone ? ` · ${esc(c.customerContact.phone)}` : ""}</b>
    <span>Partner</span><b>${esc(c.partner)} · ${esc(c.partnerContact.email)}${c.partnerContact.phone ? ` · ${esc(c.partnerContact.phone)}` : ""}</b>
    <span>Coverage</span><b>${esc(c.coverageLabel)}</b><span>Asks for</span><b>${esc(c.wantsLabel)}${c.estimateCents ? ` · estimate ${money(c.estimateCents)}` : ""}</b>
    ${c.odometer != null ? `<span>Odometer at check-in</span><b class="num">${Number(c.odometer).toLocaleString("en-US")} mi</b>` : ""}</div>
    <div class="note"><b>Customer:</b> ${esc(c.description)}</div>
    <div class="sec"><h3>Customer's photos</h3>${thumbs(c.photos)}</div>
    <div class="sec"><h3>Partner's check-in photos (before work)</h3>${thumbs(jp.checkin)}
      ${jp.damage && jp.damage.length ? `<div class="note warn">Damage noted at check-in: ${jp.damage.map((d) => `${esc(d.label)}: ${esc(d.note)}`).join("; ")}</div>` : `<p class="muted" style="margin:0;font-size:12px">No existing damage was noted at check-in.</p>`}</div>
    <div class="sec"><h3>After photos</h3>${thumbs(jp.after)}${c.workNotes ? `<div class="note">Partner notes: ${esc(c.workNotes)}</div>` : ""}</div>
    ${c.partnerResponse ? `<div class="note"><b>Partner response:</b> ${esc(c.partnerResponse)}</div>` : c.status === "partner" ? `<div class="note warn">The partner hasn't responded. Their 48 hours end ${when(c.responseDueAt)}.</div>` : `<div class="note warn">The partner didn't respond in time.</div>`}
    ${c.status === "closed" ? `<div class="note ok"><b>Decision: ${esc(c.decision.outcomeLabel)}${c.decision.amountCents ? ` · ${money(c.decision.amountCents)}` : ""}</b>${c.paidByLabel ? ` · ${esc(c.paidByLabel)}` : ""}<br>${esc(c.decision.note)}</div>
      ${c.debts.length ? `<div class="note">Partner owes ${c.debts.map((d) => `${money(d.cents)} (${money(d.owedCents)} left${d.waived ? ", waived" : ""})`).join(", ")}</div>` : ""}`
    : `<div class="sec"><h3>Decision</h3>
      <div class="field"><label for="co">Outcome</label><select class="input" id="co"><option value="">Choose…</option><option value="pay">Partner at fault · pay the customer</option><option value="goodwill">Not proven · goodwill credit</option><option value="deny">Deny · damage was there before or unrelated</option></select></div>
      <div class="field"><label for="camt">Amount ($)</label><input class="input num" id="camt" type="number" min="0" step="0.01" value="${c.estimateCents ? c.estimateCents / 100 : ""}"></div>
      <div class="field" id="cbyf"><label for="cby">Paid by</label><select class="input" id="cby">${c.paidByOptions.map((k) => `<option value="${k}">${esc(PAID_BY[k])}</option>`).join("")}</select></div>
      <textarea class="input" id="cnote" placeholder="Explain the decision (both sides see it)"></textarea>
      ${c.status === "partner" ? `<label class="muted" style="font-size:13px"><input type="checkbox" id="cforce"> Decide now without waiting for the partner</label>` : ""}
      <div class="err" id="cerr" hidden></div>
      <button class="btn primary" id="cgo">Send decision</button>
      <p class="muted" style="margin:0;font-size:12px">Goodwill credits come off the customer's next visit. Payments to the customer for approved claims happen outside the app (insurer or body shop).</p></div>`}
    <button class="btn" data-openjob="${esc(c.jobId)}">Open the job</button>`, (d) => {
    $("[data-openjob]", d).onclick = () => openJob(c.jobId);
    const go = $("#cgo", d);
    if (!go) return;
    // "Paid by" only applies when the customer is paid; the amount doesn't apply to a denial.
    const showFields = () => { const o = $("#co", d).value; $("#cbyf", d).hidden = o !== "pay"; $("#camt", d).closest(".field").hidden = o === "deny"; };
    $("#co", d).onchange = showFields;
    showFields();
    go.onclick = async () => {
      const err = $("#cerr", d);
      err.hidden = true;
      try {
        await api("POST", `/v1/admin/claims/${encodeURIComponent(c.id)}/decision`, { outcome: $("#co", d).value, amount: $("#camt", d).value, paidBy: $("#cby", d).value, note: $("#cnote", d).value, force: !!($("#cforce", d) && $("#cforce", d).checked) });
        toast("Decision sent to the customer and partner");
        openClaim(c.id);
        render();
      } catch (e) { err.textContent = errText(e); err.hidden = false; }
    };
  });
}

// ---------- Ratings ----------
V.ratings = async () => {
  const t = tabOf("ratings", "low");
  const list = (await api("GET", `/v1/admin/ratings?filter=${t}`)).ratings;
  return `<div class="ph"><div><h1>Ratings</h1><p>Customers who give 1 or 2 stars hear from support within 1 business day. Partners under 4.60 (10+ ratings) are flagged for review.</p></div></div>
  ${tabs("ratings", [["low", "Low ratings"], ["all", "All ratings"]])}
  <div class="tw"><table><thead><tr><th>Stars</th><th>Customer</th><th>Partner</th><th>Review</th><th>Private note</th><th>When</th><th></th></tr></thead><tbody>
  ${list.map((r) => `<tr><td>${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</td><td>${esc(r.customer)}</td><td>${esc(r.partner)}</td><td>${esc(r.review || "")}${r.tags.length ? `<br><span class="muted">${esc(r.tags.join(", "))}</span>` : ""}${r.hidden ? `<br>${pill("Hidden", "warn")}` : ""}</td><td>${esc(r.privateNote || "")}</td><td>${when(r.at)}</td>
    <td><div class="btns">${r.followedUp ? pill("Followed up", "ok") : r.stars <= 2 ? `<button class="btn" data-fu="${esc(r.id)}">Mark followed up</button>` : ""}${r.review && !r.hidden ? `<button class="btn" data-hide="${esc(r.id)}">Hide review</button>` : ""}<button class="btn" data-openjob="${esc(r.jobId)}">Job</button></div></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No ratings here.</td></tr>`}
  </tbody></table></div>`;
};
BIND.ratings = (main) => {
  $$("[data-openjob]", main).forEach((b) => { b.onclick = () => openJob(b.dataset.openjob); });
  $$("[data-fu]", main).forEach((b) => { b.onclick = async () => { try { await api("POST", `/v1/admin/ratings/${encodeURIComponent(b.dataset.fu)}/follow-up`); toast("Marked followed up"); render(); } catch (e) { toast(errText(e)); } }; });
  $$("[data-hide]", main).forEach((b) => {
    b.onclick = () => drawer(`${dh("Hide this review")}<p class="muted">The stars still count toward the partner's rating. Only the words are hidden.</p><div class="field"><label for="hreason">Why</label><input class="input" id="hreason" placeholder="Abusive language, personal information, or not about the service"></div><div class="err" id="herr" hidden></div><button class="btn primary" id="hgo">Hide review</button>`, (d) => {
      $("#hgo", d).onclick = async () => {
        try { await api("POST", `/v1/admin/ratings/${encodeURIComponent(b.dataset.hide)}/hide`, { reason: $("#hreason", d).value }); toast("Review hidden"); closeDrawer(); render(); }
        catch (e) { const er = $("#herr", d); er.textContent = errText(e); er.hidden = false; }
      };
    });
  });
};

// ---------- Pricing & rules ----------
let pricing = null;
V.pricing = async () => {
  const [cur, hist] = await Promise.all([api("GET", "/v1/pricing/settings"), api("GET", "/v1/pricing/settings/history")]);
  pricing = { cur, draft: { ...cur.settings } };
  return `<div class="ph"><div><h1>Pricing & rules</h1><p>Live version ${cur.version}, published ${when(cur.publishedAt)}. Changes apply to new bookings only; existing jobs keep the version they were booked under.</p></div></div>
  <div class="cfg" id="cfg">${cur.meta.map((m) => `<div class="field" data-key="${esc(m.key)}"><label for="c-${esc(m.key)}">${esc(m.label)} (${esc(m.unit)})</label>
    <input class="input num" id="c-${esc(m.key)}" type="number" step="${m.wholeNumber ? 1 : "any"}" min="${m.min}" max="${m.max}" value="${esc(cur.settings[m.key])}"><span class="hint">${esc(m.hint)}</span></div>`).join("")}</div>
  <div class="card"><div class="card-h"><h2>Publish changes</h2><span id="chg" class="muted">No changes</span></div>
    <textarea class="input" id="pnote" placeholder="Why you're changing these (kept in the history)"></textarea>
    <div class="err" id="perr2" hidden></div>
    <div class="btns"><button class="btn primary" id="publish" disabled>Publish new version</button><button class="btn" id="reset">Undo changes</button></div></div>
  <div class="card"><div class="card-h"><h2>History</h2></div><div class="log">${hist.versions.map((v) => `<div><time>v${v.version} · ${when(v.createdAt)}</time><span>${esc(v.note || "")}${v.changes.length ? ` — ${v.changes.map((c) => `${esc(c.key)}: ${esc(c.from)} → ${esc(c.to)}`).join(", ")}` : ""}</span></div>`).join("")}</div></div>`;
};
BIND.pricing = (main) => {
  const changed = () => Object.keys(pricing.draft).filter((k) => Number(pricing.draft[k]) !== Number(pricing.cur.settings[k]));
  const sync = () => {
    const ch = changed();
    $$("[data-key]", main).forEach((f) => f.classList.toggle("changed", ch.includes(f.dataset.key)));
    $("#chg", main).textContent = ch.length ? `${ch.length} change${ch.length > 1 ? "s" : ""}` : "No changes";
    $("#publish", main).disabled = !ch.length;
  };
  $$("#cfg input", main).forEach((i) => { i.oninput = () => { pricing.draft[i.id.slice(2)] = i.value === "" ? "" : Number(i.value); sync(); }; });
  $("#reset", main).onclick = () => render();
  $("#publish", main).onclick = async () => {
    const changes = Object.fromEntries(changed().map((k) => [k, pricing.draft[k]]));
    const err = $("#perr2", main);
    err.hidden = true;
    try {
      const r = await api("POST", "/v1/pricing/settings", { changes, note: $("#pnote", main).value, expectedVersion: pricing.cur.version });
      toast(`Published version ${r.version}`);
      render();
    } catch (e) { err.textContent = errText(e); err.hidden = false; }
  };
  sync();
};

// ---------- Start ----------
$("#signout").onclick = async () => { await api("POST", "/v1/auth/logout").catch(() => {}); signOutLocal(); };
$("#gsearch").onkeydown = (e) => { if (e.key === "Enter") { S.q = e.target.value; S.tab.jobs = "all"; go("jobs"); } };
start();
