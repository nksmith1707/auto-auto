// Delivery for notifications: phone alerts (Expo's push service), texts (Twilio), and email (Resend or Postmark).
// Each provider is "connected" only when its keys are set in the server's environment. Keys never leave the server.

export class DeliveryError extends Error {
  constructor(message, { permanent = false, code = null } = {}) {
    super(message);
    this.permanent = permanent;
    this.code = code;
  }
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

// Phone alerts. Expo forwards them to Apple and Google. An access token is optional (only if "enhanced security" is on).
export function createPush({ baseUrl = "https://exp.host", accessToken = null, fetchImpl = globalThis.fetch } = {}) {
  return {
    connected: true,
    // messages: [{ to, title, body, data }]. Returns one result per message: "ok", "gone" (remove the token), or an error.
    async send(messages) {
      if (!messages.length) return [];
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/--/api/v2/push/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(messages.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data || {}, sound: "default" }))),
      });
      const out = await readJson(res);
      if (!res.ok || !out || !Array.isArray(out.data)) throw new DeliveryError(`Expo push answered ${res.status}`);
      return out.data.map((d) => (d.status === "ok" ? "ok" : d.details && d.details.error === "DeviceNotRegistered" ? "gone" : d.message || "error"));
    },
  };
}

// Texts through Twilio. Needs the account SID, auth token, and a sending number or messaging service.
export function createSms({ accountSid, authToken, from, messagingServiceSid, baseUrl = "https://api.twilio.com", fetchImpl = globalThis.fetch } = {}) {
  const connected = !!(accountSid && authToken && (from || messagingServiceSid));
  return {
    connected,
    provider: connected ? "Twilio" : null,
    async send({ to, body }) {
      if (!connected) throw new DeliveryError("Texts aren't connected.", { permanent: true, code: "not_connected" });
      const form = new URLSearchParams({ To: to, Body: body });
      if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
      else form.set("From", from);
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
        body: form.toString(),
      });
      const out = await readJson(res);
      if (res.ok) return { id: out && out.sid };
      const code = out && out.code;
      // 21610: the person replied STOP. 21211/21614: not a number that can get texts. Don't retry these.
      throw new DeliveryError(`Twilio ${res.status}${code ? ` (${code})` : ""}: ${(out && out.message) || "error"}`, { permanent: res.status < 500, code: code ? String(code) : null });
    },
  };
}

// Email through Resend or Postmark, whichever key is set (Resend wins if both are).
export function createEmail({ resendKey, postmarkToken, from, resendBaseUrl = "https://api.resend.com", postmarkBaseUrl = "https://api.postmarkapp.com", fetchImpl = globalThis.fetch } = {}) {
  const provider = resendKey ? "Resend" : postmarkToken ? "Postmark" : null;
  // Resend can send test emails from its own address (only to the account owner's email) until a domain is verified.
  const sender = from || (provider === "Resend" ? "Auto-Auto <onboarding@resend.dev>" : null);
  const connected = !!(provider && sender);
  return {
    connected,
    provider: connected ? provider : null,
    async send({ to, subject, text }) {
      if (!connected) throw new DeliveryError("Email isn't connected.", { permanent: true, code: "not_connected" });
      let res;
      if (provider === "Resend") {
        res = await fetchImpl(`${resendBaseUrl.replace(/\/+$/, "")}/emails`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: sender, to: [to], subject, text }),
        });
      } else {
        res = await fetchImpl(`${postmarkBaseUrl.replace(/\/+$/, "")}/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": postmarkToken },
          body: JSON.stringify({ From: sender, To: to, Subject: subject, TextBody: text, MessageStream: "outbound" }),
        });
      }
      const out = await readJson(res);
      if (res.ok) return { id: out && (out.id || out.MessageID) };
      throw new DeliveryError(`${provider} ${res.status}: ${(out && (out.message || out.Message)) || "error"}`, { permanent: res.status < 500 && res.status !== 429 });
    },
  };
}

// US numbers as +1XXXXXXXXXX. Returns null for anything that can't get a text.
export function toE164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
