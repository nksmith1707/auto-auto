// Ops Console: the staff website (served at /ops) and the staff-only endpoints it uses.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { send, HttpError } from "../lib/http.js";
import { requireUser } from "../auth/routes.js";

const OPS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../ops");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function adminRoutes(router, { auth, admin }) {
  const staff = async (req) => (await requireUser(req, auth, ["admin"])).user;

  router.get("/v1/admin/overview", async (req, res) => { await staff(req); send(res, 200, await admin.overview()); });
  router.get("/v1/admin/jobs", async (req, res) => {
    await staff(req);
    send(res, 200, { jobs: await admin.jobs({ filter: req.query.get("filter") || "open", q: req.query.get("q") || "" }) });
  });
  router.get("/v1/admin/jobs/:id", async (req, res) => { await staff(req); send(res, 200, { job: await admin.job(req.params.id) }); });
  router.get("/v1/admin/insurance", async (req, res) => { await staff(req); send(res, 200, { policies: await admin.insurance() }); });
  router.get("/v1/admin/payouts", async (req, res) => { await staff(req); send(res, 200, await admin.payouts()); });

  // The console itself: plain files, no build step. Sign-in happens on the page with a staff account.
  const serve = async (res, file) => {
    const ext = path.extname(file);
    if (!TYPES[ext] || file.includes("..")) throw new HttpError(404, "not_found", "That page doesn't exist.");
    let body;
    try { body = await readFile(path.join(OPS_DIR, file)); } catch { throw new HttpError(404, "not_found", "That page doesn't exist."); }
    res.writeHead(200, { "Content-Type": TYPES[ext], "Cache-Control": "no-cache", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    res.end(body);
  };
  router.get("/ops", async (req, res) => serve(res, "index.html"));
  router.get("/ops/:file", async (req, res) => serve(res, req.params.file));
}
