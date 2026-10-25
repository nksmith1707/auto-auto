// Session storage in a web browser (used for local testing only; the apps ship to phones).
// Browsers have no keychain, so this keeps the session for the life of the tab.
const mem = new Map();
const ss = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

export const storage = {
  async get(key) { const s = ss(); return s ? s.getItem(key) : mem.get(key) ?? null; },
  async set(key, value) { const s = ss(); s ? s.setItem(key, value) : mem.set(key, value); },
  async remove(key) { const s = ss(); s ? s.removeItem(key) : mem.delete(key); },
};
