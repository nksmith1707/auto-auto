// Email sending. For now: in development, messages are kept in memory and printed; in production nothing is sent
// until an email provider is connected (next step). The interface stays the same either way.
export function createMailer({ isProd, log = console.log } = {}) {
  const outbox = [];
  return {
    outbox,
    async send({ to, subject, text }) {
      outbox.push({ to, subject, text, at: Date.now() });
      if (outbox.length > 100) outbox.shift();
      if (isProd) log(`[mail] provider not connected yet; dropped "${subject}"`);
      else log(`[mail] to=${to} subject="${subject}"\n${text}`);
    },
  };
}
