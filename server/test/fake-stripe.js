// A small stand-in for Stripe's API, so tests (and local browser tests) never need the real thing.
// It remembers customers, saved cards, payment intents, refunds, connected accounts, and transfers.

function parseForm(body) {
  const out = {};
  for (const part of (body || "").split("&").filter(Boolean)) {
    const [k, v = ""] = part.split("=").map(decodeURIComponent);
    const keys = k.replace(/\]/g, "").split("[");
    let o = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) o[key] = v;
      else o = o[key] = o[key] || {};
    });
  }
  return out;
}

export function createFakeStripe({ checkoutBase = "https://checkout.stripe.test" } = {}) {
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  const st = { identity: {}, customers: {}, sessions: {}, pms: {}, intents: {}, refunds: [], accounts: {}, transfers: [], idem: {}, calls: [], failTransfers: false };
  const err = (status, type, code, message, decline) => ({ status, body: { error: { type, code, message, decline_code: decline } } });

  function handle(method, path, params, idemKey) {
    st.calls.push({ method, path, params });
    if (idemKey && st.idem[idemKey]) return st.idem[idemKey];
    const r = route(method, path, params);
    if (idemKey && r.status < 500) st.idem[idemKey] = r;
    return r;
  }

  function route(method, path, p) {
    let m;
    if (method === "POST" && path === "/v1/customers") {
      const c = { id: id("cus"), email: p.email };
      st.customers[c.id] = c;
      return { status: 200, body: c };
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      if (p.mode !== "setup" || !st.customers[p.customer]) return err(400, "invalid_request_error", "parameter_invalid", "bad session");
      const s = { id: id("cs"), mode: "setup", customer: p.customer, success_url: p.success_url, cancel_url: p.cancel_url };
      s.url = `${checkoutBase}/${s.id}`;
      st.sessions[s.id] = s;
      return { status: 200, body: s };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/customers\/([^/]+)\/payment_methods$/))) {
      const data = Object.values(st.pms).filter((x) => x.customer === m[1]);
      return { status: 200, body: { object: "list", data } };
    }
    if (method === "POST" && (m = path.match(/^\/v1\/payment_methods\/([^/]+)\/detach$/))) {
      if (!st.pms[m[1]]) return err(404, "invalid_request_error", "resource_missing", "No such payment method");
      st.pms[m[1]].customer = null;
      return { status: 200, body: st.pms[m[1]] };
    }
    if (method === "POST" && path === "/v1/payment_intents") {
      const pm = st.pms[p.payment_method];
      if (!pm || pm.customer !== p.customer) return err(400, "invalid_request_error", "resource_missing", "No such payment method");
      const amount = Number(p.amount);
      if (pm.behavior === "decline") return err(402, "card_error", "card_declined", "Your card was declined.", "insufficient_funds");
      const pi = { id: id("pi"), amount, customer: p.customer, payment_method: pm.id, capture_method: p.capture_method, metadata: p.metadata, amount_received: 0 };
      if (pm.behavior === "auth") pi.status = "requires_action";
      else if (p.capture_method === "manual") pi.status = "requires_capture";
      else { pi.status = "succeeded"; pi.amount_received = amount; }
      st.intents[pi.id] = pi;
      return { status: 200, body: pi };
    }
    if (method === "POST" && (m = path.match(/^\/v1\/payment_intents\/([^/]+)\/capture$/))) {
      const pi = st.intents[m[1]];
      if (!pi || pi.status !== "requires_capture") return err(400, "invalid_request_error", "payment_intent_unexpected_state", "Can't capture");
      const amt = p.amount_to_capture != null ? Number(p.amount_to_capture) : pi.amount;
      if (amt > pi.amount) return err(400, "invalid_request_error", "amount_too_large", "Too much");
      pi.status = "succeeded";
      pi.amount_received = amt;
      return { status: 200, body: pi };
    }
    if (method === "POST" && (m = path.match(/^\/v1\/payment_intents\/([^/]+)\/cancel$/))) {
      const pi = st.intents[m[1]];
      if (!pi) return err(404, "invalid_request_error", "resource_missing", "No such intent");
      pi.status = "canceled";
      return { status: 200, body: pi };
    }
    if (method === "POST" && path === "/v1/refunds") {
      const pi = st.intents[p.payment_intent];
      const amt = Number(p.amount);
      const already = st.refunds.filter((r) => r.payment_intent === pi?.id).reduce((a, r) => a + r.amount, 0);
      if (!pi || pi.status !== "succeeded" || already + amt > pi.amount_received) return err(400, "invalid_request_error", "charge_already_refunded", "Can't refund that much");
      const r = { id: id("re"), payment_intent: pi.id, amount: amt, status: "succeeded" };
      st.refunds.push(r);
      return { status: 200, body: r };
    }
    // Like the real Stripe now: new Connect platforms must create accounts with Accounts v2.
    if (method === "POST" && path === "/v1/accounts") return err(400, "invalid_request_error", "v1_accounts_unsupported", "Stripe no longer recommends Accounts v1 for new Connect integrations. Create connected accounts with POST /v2/core/accounts instead.");
    if (method === "POST" && path === "/v2/core/accounts") {
      const rec = p.configuration && p.configuration.recipient && p.configuration.recipient.capabilities && p.configuration.recipient.capabilities.stripe_balance;
      const unknown = rec && Object.keys(rec).find((k) => k !== "stripe_transfers");
      if (unknown) return err(400, "invalid_request_error", "invalid_fields", `Some fields in the request were invalid: 'configuration.recipient.capabilities.stripe_balance.${unknown}: Unknown field.'`);
      if (!rec || !rec.stripe_transfers || rec.stripe_transfers.requested !== true) return err(400, "invalid_request_error", "parameter_missing", "Request the stripe_transfers capability");
      const resp = p.defaults && p.defaults.responsibilities;
      if (!["express", "none"].includes(p.dashboard) || !resp || resp.losses_collector !== "application" || resp.fees_collector !== "application") return err(400, "invalid_request_error", "invalid_combination", "Recipient-only accounts need dashboard express/none and application responsibilities");
      const a = { id: id("acct"), object: "v2.core.account", email: p.contact_email, display_name: p.display_name, payouts_enabled: false, details_submitted: false };
      st.accounts[a.id] = a;
      return { status: 200, body: a };
    }
    if (method === "POST" && path === "/v2/core/account_links") {
      const ob = p.use_case && p.use_case.account_onboarding;
      if (!st.accounts[p.account] || !p.use_case || p.use_case.type !== "account_onboarding" || !ob || !ob.return_url || !ob.refresh_url) return err(400, "invalid_request_error", "parameter_missing", "bad account link");
      return { status: 200, body: { object: "v2.core.account_link", url: `${checkoutBase}/onboard/${p.account}?return=${encodeURIComponent(ob.return_url)}`, use_case: p.use_case } };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/accounts\/([^/]+)$/))) {
      const a = st.accounts[m[1]];
      return a ? { status: 200, body: a } : err(404, "invalid_request_error", "resource_missing", "No such account");
    }
    if (method === "POST" && path === "/v1/account_links") {
      if (!st.accounts[p.account]) return err(400, "invalid_request_error", "resource_missing", "No such account");
      return { status: 200, body: { url: `${checkoutBase}/onboard/${p.account}?return=${encodeURIComponent(p.return_url)}`, return_url: p.return_url } };
    }
    if (method === "POST" && path === "/v1/transfers") {
      if (st.failTransfers) return err(400, "invalid_request_error", "balance_insufficient", "Insufficient funds in Stripe account");
      if (!st.accounts[p.destination]) return err(400, "invalid_request_error", "resource_missing", "No such destination");
      const t = { id: id("tr"), amount: Number(p.amount), destination: p.destination, metadata: p.metadata };
      st.transfers.push(t);
      return { status: 200, body: t };
    }
    if (method === "POST" && path === "/v1/identity/verification_sessions") {
      if (p.type !== "document" || !p.return_url) return err(400, "invalid_request_error", "parameter_missing", "type and return_url are required");
      const v = { id: id("vs"), status: "requires_input", return_url: p.return_url, options: p.options, metadata: p.metadata, last_error: null, verified_outputs: null };
      v.url = `${checkoutBase}/identity/${v.id}`;
      st.identity[v.id] = v;
      return { status: 200, body: v };
    }
    if (method === "GET" && (m = path.match(/^\/v1\/identity\/verification_sessions\/([^/]+)$/))) {
      const v = st.identity[m[1]];
      if (!v) return err(404, "invalid_request_error", "resource_missing", "No such verification session");
      const out = { ...v };
      if (!(p.expand && Object.values(p.expand).includes("verified_outputs"))) delete out.verified_outputs;
      return { status: 200, body: out };
    }
    return err(404, "invalid_request_error", "unknown", `Unrecognized request URL (${method}: ${path})`);
  }

  return {
    state: st,
    // What happens when a customer finishes Stripe's card page.
    addCard(customer, { last4 = "4242", brand = "visa", behavior = "ok" } = {}) {
      const pm = { id: id("pm"), customer, card: { brand, last4, exp_month: 12, exp_year: 2030 }, behavior };
      st.pms[pm.id] = pm;
      return pm;
    },
    finishSession(sessionId, card) {
      const s = st.sessions[sessionId];
      this.addCard(s.customer, card);
      return s.success_url;
    },
    // What happens when a partner finishes Stripe's ID check page.
    finishIdentity(sessionId, { dob = { day: 4, month: 7, year: 1990 }, fail = false } = {}) {
      const v = st.identity[sessionId];
      if (fail) Object.assign(v, { status: "requires_input", last_error: { code: "document_expired", reason: "The document is expired." } });
      else Object.assign(v, { status: "verified", last_error: null, verified_outputs: { dob, first_name: "Test", last_name: "Partner" } });
      return v.return_url;
    },
    finishOnboarding(accountId) { Object.assign(st.accounts[accountId], { payouts_enabled: true, details_submitted: true }); },
    handle,
    async fetch(url, opts = {}) {
      const u = new URL(url);
      const json = opts.headers && String(opts.headers["Content-Type"] || "").includes("json");
      const params = opts.method === "GET" ? parseForm(u.search.slice(1)) : json ? JSON.parse(opts.body || "{}") : parseForm(opts.body);
      const r = handle(opts.method || "GET", u.pathname, params, opts.headers && opts.headers["Idempotency-Key"]);
      return { status: r.status, json: async () => JSON.parse(JSON.stringify(r.body)) };
    },
    parseForm,
  };
}
