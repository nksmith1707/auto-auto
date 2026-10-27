// Partner application endpoints, and staff review until the Ops Console (step 12) has screens for it.
import { readJson, send, clientIp, HttpError } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";
import { safeReturn } from "../payments/routes.js";

const UPLOAD_MAX = 9 * 1024 * 1024; // 6 MB files arrive as base64 text, about a third bigger.

export function onboardingRoutes(router, { auth, onboarding, config }) {
  const partner = async (req) => (await requireUser(req, auth, ["partner"])).user;
  const staff = async (req) => (await requireUser(req, auth, ["admin"])).user;
  const apiBase = (req) => {
    if (config.publicUrl) return config.publicUrl.replace(/\/$/, "");
    const proto = config.trustProxy && req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]).split(",")[0] : "http";
    return `${proto}://${req.headers.host}`;
  };
  const sendFile = (res, f) => {
    res.writeHead(200, {
      "Content-Type": f.contentType, "Content-Length": f.bytes.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${f.filename.replace(/"/g, "")}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(f.bytes);
  };

  router.get("/v1/onboarding", async (req, res) => {
    const u = await partner(req);
    send(res, 200, await onboarding.state(u.id));
  });
  router.put("/v1/onboarding/steps/:step", async (req, res) => {
    const u = await partner(req);
    send(res, 200, await onboarding.save(u, req.params.step, await readJson(req)));
  });
  router.get("/v1/onboarding/documents/:id", async (req, res) => {
    await requireUser(req, auth, ["partner", "admin"]);
    send(res, 200, { document: onboarding.document(req.params.id) });
  });
  router.post("/v1/onboarding/sign", async (req, res) => {
    const u = await partner(req);
    const b = await readJson(req);
    send(res, 200, await onboarding.sign(u, String(b.docId || ""), b.name, { ip: clientIp(req, config.trustProxy), userAgent: req.headers["user-agent"] }));
  });
  router.post("/v1/onboarding/arbitration-opt-out", async (req, res) => {
    const u = await partner(req);
    send(res, 200, await onboarding.optOutOfArbitration(u));
  });
  router.post("/v1/onboarding/files", async (req, res) => {
    const u = await partner(req);
    send(res, 201, await onboarding.upload(u, await readJson(req, { max: UPLOAD_MAX })));
  });
  router.delete("/v1/onboarding/files/:id", async (req, res) => {
    const u = await partner(req);
    send(res, 200, await onboarding.removeUpload(u, req.params.id));
  });
  router.get("/v1/onboarding/files/:id", async (req, res) => {
    const u = await partner(req);
    sendFile(res, await onboarding.file(req.params.id, { userId: u.id }));
  });
  router.post("/v1/onboarding/identity", async (req, res) => {
    const u = await partner(req);
    const b = await readJson(req);
    send(res, 200, await onboarding.startIdentity(u, { returnTo: safeReturn(b.returnUrl, config) || "", apiBase: apiBase(req) }));
  });
  router.post("/v1/onboarding/identity/sync", async (req, res) => {
    const u = await partner(req);
    send(res, 200, await onboarding.syncIdentity(u));
  });
  router.post("/v1/onboarding/submit", async (req, res) => {
    const u = await partner(req);
    send(res, 200, await onboarding.submit(u, await readJson(req)));
  });

  // ---------- Staff ----------
  router.get("/v1/admin/applications", async (req, res) => {
    await staff(req);
    send(res, 200, { applications: await onboarding.list() });
  });
  router.get("/v1/admin/applications/:id", async (req, res) => {
    await staff(req);
    send(res, 200, await onboarding.staffView(req.params.id));
  });
  router.get("/v1/admin/documents/:id/file", async (req, res) => {
    await staff(req);
    sendFile(res, await onboarding.file(req.params.id, { staff: true }));
  });
  router.post("/v1/admin/documents/:id/review", async (req, res) => {
    const s = await staff(req);
    send(res, 200, await onboarding.reviewDocument(s, req.params.id, await readJson(req)));
  });
  router.post("/v1/admin/applications/:id/background", async (req, res) => {
    const s = await staff(req);
    send(res, 200, await onboarding.setBackground(s, req.params.id, await readJson(req)));
  });
  router.post("/v1/admin/applications/:id/identity", async (req, res) => {
    const s = await staff(req);
    send(res, 200, await onboarding.setIdentity(s, req.params.id, await readJson(req)));
  });
  router.post("/v1/admin/applications/:id/decision", async (req, res) => {
    const s = await staff(req);
    const b = await readJson(req);
    if (!b || typeof b.decision !== "string") throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { decision: "Choose approve, return, or deny." } });
    send(res, 200, await onboarding.decide(s, req.params.id, b));
  });
}
