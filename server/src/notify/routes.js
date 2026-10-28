// Notification endpoints: the inbox, settings (push, text, email per kind of update), and phone alert registration.
import { readJson, send } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";

export function notifyRoutes(router, { auth, notify }) {
  const who = async (req, roles = ["customer", "partner"]) => (await requireUser(req, auth, roles)).user;

  router.get("/v1/notifications", async (req, res) => send(res, 200, await notify.inbox(await who(req))));
  router.post("/v1/notifications/read", async (req, res) => { const u = await who(req); send(res, 200, await notify.markRead(u, await readJson(req))); });
  router.get("/v1/notifications/settings", async (req, res) => send(res, 200, await notify.settings(await who(req))));
  router.put("/v1/notifications/settings", async (req, res) => { const u = await who(req); send(res, 200, await notify.saveSettings(u, await readJson(req))); });
  router.post("/v1/push-tokens", async (req, res) => { const u = await who(req); send(res, 200, await notify.addPushToken(u, await readJson(req))); });
  router.post("/v1/push-tokens/remove", async (req, res) => { const u = await who(req); send(res, 200, await notify.removePushToken(u, await readJson(req))); });
  router.get("/v1/admin/notifications", async (req, res) => { await who(req, ["admin"]); send(res, 200, await notify.status()); });
}
