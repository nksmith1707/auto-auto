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
  api("GET", "/v1/admin/overview").then((o) => { counts = { apps: o.applications, incidents: o.incidentsOpen, jobs: o.jobsLate + o.paymentProblems, insurance: o.insuranceExpired, payouts: o.payoutsFailed }; side(); }).catch(() => {});
}

// ---------- Layout ----------
const VIEWS = [["overview", "Overview"], ["jobs", "Jobs"], ["apps", "Applications"], ["partners", "Partners"], ["incidents", "Incidents"], ["insurance", "Insurance"], ["payouts", "Payouts"], ["pricing", "Pricing & rules"]];
let counts = {};

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

async function render() {
  side();
  const main = $("#main");
  main.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    main.innerHTML = await V[S.v]();
  } catch (e) {
    main.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    return;
  }
  $$("[data-tab]", main).forEach((b) => { b.onclick = () => { const [k, t] = b.dataset.tab.split("|"); S.tab[k] = t; render(); }; });
  $$("[data-go]", main).forEach((b) => { b.onclick = () => { const [v, t] = b.dataset.go.split("|"); go(v, t); }; });
  if (BIND[S.v]) BIND[S.v](main);
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
  counts = { apps: o.applications, incidents: o.incidentsOpen, jobs: o.jobsLate + o.paymentProblems, insurance: o.insuranceExpired, payouts: o.payoutsFailed };
  side();
  const att = [
    [o.applications, "brand", `${o.applications} application${o.applications === 1 ? "" : "s"} waiting for a decision`, "apps"],
    [o.jobsLate, "bad", `${o.jobsLate} job${o.jobsLate === 1 ? "" : "s"} where the partner hasn't left 30 minutes before the window`, "jobs|late"],
    [o.paymentProblems, "bad", `${o.paymentProblems} job${o.paymentProblems === 1 ? "" : "s"} with a declined card`, "jobs|payment"],
    [o.incidentsOpen, "warn", `${o.incidentsOpen} incident report${o.incidentsOpen === 1 ? "" : "s"} open`, "incidents"],
    [o.insuranceExpired, "bad", `${o.insuranceExpired} partner polic${o.insuranceExpired === 1 ? "y has" : "ies have"} expired (those partners can't take jobs)`, "insurance"],
    [o.insuranceExpiring, "warn", `${o.insuranceExpiring} polic${o.insuranceExpiring === 1 ? "y expires" : "ies expire"} within 30 days`, "insurance"],
    [o.partnersFlagged, "warn", `${o.partnersFlagged} partner${o.partnersFlagged === 1 ? "" : "s"} flagged for review (late cancels)`, "partners"],
    [o.payoutsFailed, "bad", `${o.payoutsFailed} payout${o.payoutsFailed === 1 ? "" : "s"} failed this week`, "payouts"],
  ].filter((x) => x[0]);
  return `<div class="ph"><div><h1>Today</h1><p>What needs attention first. Everything here is live.</p></div></div>
  <div class="kpis">
    <div class="kpi"><span>Jobs live now</span><b>${o.jobsLive}</b><small class="muted">on the way or working</small></div>
    <div class="kpi"><span>Waiting for a partner</span><b>${o.jobsWaiting}</b><small class="muted">requested or awaiting approval</small></div>
    <div class="kpi"><span>Completed today</span><b>${o.today.completed}</b><small class="muted">${money(o.today.chargedCents)} charged</small></div>
    <div class="kpi"><span>Active partners</span><b>${o.partnersActive}</b><small class="muted">${o.customers} customers</small></div>
  </div>
  <div class="card"><div class="card-h"><h2>Needs attention</h2></div>
    ${att.length ? `<div class="att">${att.map(([, tone, text, to]) => `<button data-go="${to}"><span class="sev ${tone}"></span><span class="grow">${esc(text)}</span><span class="muted">›</span></button>`).join("")}</div>`
      : `<p class="muted" style="margin:0">Nothing needs attention right now.</p>`}
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

const EVENT = { booked: "Booked", accepted: "Partner accepted", confirmed: "Confirmed", trip_started: "Partner on the way", arrived: "Partner arrived", checked_in: "Work started", completed: "Completed", cancelled: "Cancelled", expired: "No partner found", rescheduled: "Rescheduled", offer_sent: "Offer sent", offer_declined: "Partner passed", offer_expired: "Offer timed out", sent_to_all: "Sent to all partners", search_widened: "Search widened", no_show: "No-show", partner_cancelled: "Partner cancelled", partner_late_cancel: "Partner cancelled late", addons_requested: "Add-ons requested", addon_approved: "Add-on approved", addon_declined: "Add-on declined", glass_quote_sent: "Glass quote sent", glass_approved: "Glass approved", glass_declined: "Glass declined", incident_reported: "Incident reported", deposit_failed: "Deposit declined", partner_approved: "Customer approved partner", partner_declined_by_customer: "Customer declined partner", approval_timed_out: "Approval timed out", switched_partner: "Customer switched partner" };

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
  <div class="card"><div class="card-h"><h2>Balances</h2></div><div class="tw"><table><thead><tr><th>Partner</th><th>Schedule</th><th class="r">Available</th><th class="r">Reserve</th><th>Last payout</th><th>Payouts</th></tr></thead><tbody>
  ${r.partners.map((p) => `<tr><td><b>${esc(p.partner)}</b><br><span class="muted">${esc(p.email)}</span></td><td>${esc(p.schedule)} · ${p.jobsDone} jobs</td><td class="r">${money(p.availableCents)}</td><td class="r">${money(p.reserveCents)}</td><td>${p.lastPayout ? `${money(p.lastPayout.amountCents)} · ${when(p.lastPayout.at)}` : "—"}</td><td>${p.payoutsEnabled ? pill("On", "ok") : pill("Setup unfinished", "warn")}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No partners have set up payouts yet.</td></tr>`}
  </tbody></table></div></div>
  <div class="card"><div class="card-h"><h2>Recent payouts</h2></div><div class="tw"><table><thead><tr><th>Partner</th><th>Kind</th><th class="r">Amount</th><th class="r">Fee</th><th>Status</th><th>When</th></tr></thead><tbody>
  ${r.payouts.map((p) => `<tr><td>${esc(p.partner)}</td><td>${esc(p.kind)}</td><td class="r">${money(p.amountCents)}</td><td class="r">${money(p.feeCents)}</td><td>${p.status === "paid" ? pill("Paid", "ok") : pill(`Failed${p.error ? `: ${p.error}` : ""}`, "bad")}</td><td>${when(p.at)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No payouts yet.</td></tr>`}
  </tbody></table></div></div>`;
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
