// Photo endpoints: job check-in and after photos, signed photo links, service history, incident reports.
import { readJson, send } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";

const PHOTO_MAX = 9 * 1024 * 1024; // One 6 MB photo as base64.
const INCIDENT_MAX = 34 * 1024 * 1024; // Up to 4 photos.

export function photoRoutes(router, { auth, photos }) {
  const who = async (req, roles) => (await requireUser(req, auth, roles)).user;

  router.post("/v1/jobs/:id/photos", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 201, { photos: await photos.upload(u, req.params.id, await readJson(req, { max: PHOTO_MAX })) });
  });
  router.post("/v1/jobs/:id/photos/:slot/damage", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 200, { photos: await photos.noteDamage(u, req.params.id, req.params.slot, await readJson(req)) });
  });

  // No sign-in needed: the link itself is signed and expires after a few hours.
  router.get("/v1/photos/:id", async (req, res) => {
    const f = await photos.file(req.params.id, req.query.get("exp"), req.query.get("sig"));
    res.writeHead(200, { "Content-Type": f.contentType, "Content-Length": f.bytes.length, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" });
    res.end(f.bytes);
  });

  router.get("/v1/vehicles/:id/history", async (req, res) => {
    const u = await who(req, ["customer"]);
    send(res, 200, await photos.history(u, req.params.id));
  });

  router.get("/v1/incidents", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 200, { incidents: await photos.myIncidents(u), jobs: await photos.reportableJobs(u) });
  });
  router.post("/v1/incidents", async (req, res) => {
    const u = await who(req, ["partner"]);
    send(res, 201, { incident: await photos.report(u, await readJson(req, { max: INCIDENT_MAX })) });
  });
  router.get("/v1/admin/incidents", async (req, res) => {
    await who(req, ["admin"]);
    send(res, 200, { incidents: await photos.allIncidents(req.query.get("status") || "") });
  });
  router.post("/v1/admin/incidents/:id/close", async (req, res) => {
    const s = await who(req, ["admin"]);
    send(res, 200, { incident: await photos.closeIncident(s, req.params.id, await readJson(req)) });
  });
}
