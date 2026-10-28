// Account emails (password reset codes). Sent right away through the email provider when one is connected
// (RESEND_API_KEY or POSTMARK_SERVER_TOKEN). Without one: printed to the server log in development, dropped in production.
// The last 100 messages are kept in memory for tests.
export function createMailer({ isProd, email = null, log = console.log } = {}) {
  const outbox = [];
  return {
    outbox,
    async send({ to, subject, text }) {
      outbox.push({ to, subject, text, at: Date.now() });
      if (outbox.length > 100) outbox.shift();
      if (email && email.connected) {
        try { await email.send({ to, subject, text }); } catch (e) { log(`[mail] couldn't send "${subject}": ${e.message}`); }
        return;
      }
      if (isProd) log(`[mail] email isn't connected yet; dropped "${subject}"`);
      else log(`[mail] to=${to} subject="${subject}"\n${text}`);
    },
  };
}
