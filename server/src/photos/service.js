// Photos and proof of work (RULES.md: 12 check-in photos and the odometer before work; 2 after photos and
// the inspection before Complete), vehicle service history, and partner incident reports.
// Photo files are shown through short-lived signed links, so the apps can display them like any image.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "../lib/http.js";
import { newId } from "../auth/tokens.js";
import { looksLike } from "../onboarding/service.js";
import { serviceById } from "../catalog/services.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const LINK_HOURS = 6;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export const CHECKIN_SLOTS = [
  ["e0", "Front"], ["e1", "Front right"], ["e2", "Right side"], ["e3", "Rear right"], ["e4", "Rear"], ["e5", "Rear left"], ["e6", "Left side"], ["e7", "Front left"],
  ["i0", "Dash & odometer"], ["i1", "Front seats"], ["i2", "Rear seats"], ["i3", "Cargo area"],
];
export const AFTER_SLOTS = [["a0", "After 1"], ["a1", "After 2"]];
const LABEL = Object.fromEntries([...CHECKIN_SLOTS, ...AFTER_SLOTS]);
export const INCIDENT_TYPES = {
  vehicle_damage: "Damage to customer vehicle", property_damage: "Damage to customer property", injury: "Someone got hurt",
  unsafe: "Unsafe situation", customer_behavior: "Customer behavior",
};
const bad = (field, msg) => new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: msg } });
const notFound = () => new HttpError(404, "not_found", "That job isn't on your account. Pull to refresh and try again.");
const J = (s, d) => (s ? JSON.parse(s) : d);

export function createPhotos({ db, secret = randomBytes(32).toString("hex"), now = () => Date.now() }) {
  const sign = (id, exp) => createHmac("sha256", secret).update(`${id}.${exp}`).digest("base64url");
  const link = (id) => { const exp = now() + LINK_HOURS * HOUR; return `/v1/photos/${id}?exp=${exp}&sig=${sign(id, exp)}`; };

  function decode(p, field = "photo") {
    const type = String((p && p.contentType) || "").toLowerCase().replace("image/jpg", "image/jpeg");
    if (!IMAGE_TYPES.includes(type)) throw bad(field, "Upload a photo (JPG, PNG, or HEIC).");
    if (!p.data || typeof p.data !== "string") throw bad(field, "Take or choose a photo.");
    const buf = Buffer.from(p.data.replace(/^data:[^,]*,/, ""), "base64");
    if (!buf.length) throw bad(field, "That photo is empty.");
    if (buf.length > MAX_PHOTO_BYTES) throw bad(field, "That photo is over 6 MB. Try again.");
    if (!looksLike(type, buf)) throw bad(field, "That file doesn't look like a photo. Try again.");
    return { type, buf };
  }

  async function storeBlob(t, { type, buf }) {
    const id = newId();
    await t.run(`INSERT INTO blobs (id, content_type, size_bytes, data, created_at) VALUES ($1, $2, $3, $4, $5)`, [id, type, buf.length, buf.toString("base64"), now()]);
    return id;
  }

  const photoOut = (p) => ({ id: p.id, slot: p.slot, label: p.kind === "incident" ? "Photo" : LABEL[p.slot], kind: p.kind, damageNote: p.damage_note, takenAt: p.created_at, url: link(p.id) });

  // Current photos for a job (or a fleet vehicle on a run), grouped. Each comes with a link that works for a few hours.
  const OWNER = { job: "job_id", fleet: "run_vehicle_id" };
  const forJob = (q, jobId) => forOwner(q, "job", jobId);
  async function forOwner(q, owner, ownerId) {
    const rows = await q.all(`SELECT * FROM photos WHERE ${OWNER[owner]} = $1 AND replaced_at IS NULL AND kind IN ('checkin', 'after') ORDER BY slot`, [ownerId]);
    const by = Object.fromEntries(rows.map((r) => [r.slot, r]));
    return {
      checkin: CHECKIN_SLOTS.filter(([s]) => by[s]).map(([s]) => photoOut(by[s])),
      after: AFTER_SLOTS.filter(([s]) => by[s]).map(([s]) => photoOut(by[s])),
      checkinNeeded: CHECKIN_SLOTS.filter(([s]) => !by[s]).map(([slot, label]) => ({ slot, label })),
      afterNeeded: AFTER_SLOTS.filter(([s]) => !by[s]).map(([slot, label]) => ({ slot, label })),
      damage: CHECKIN_SLOTS.filter(([s]) => by[s] && by[s].damage_note).map(([s, label]) => ({ slot: s, label, note: by[s].damage_note })),
    };
  }

  async function partnerJob(user, jobId) {
    const job = await db.get(`SELECT * FROM jobs WHERE id = $1`, [String(jobId)]);
    if (!job || job.partner_id !== user.id) throw notFound();
    return job;
  }

  const slotKind = (slot) => (CHECKIN_SLOTS.some(([s]) => s === slot) ? "checkin" : AFTER_SLOTS.some(([s]) => s === slot) ? "after" : null);

  // Saves one slot's photo (replacing any earlier one). Callers check who may upload and when.
  async function saveSlot(owner, ownerId, user, b, { allow }) {
    const slot = String(b.slot || "");
    const kind = slotKind(slot);
    if (!kind) throw bad("slot", "Pick which photo this is.");
    allow(kind);
    const file = decode(b);
    const note = typeof b.damageNote === "string" ? b.damageNote.trim().slice(0, 200) || null : null;
    await db.tx(async (t) => {
      const blobId = await storeBlob(t, file);
      await t.run(`UPDATE photos SET replaced_at = $1 WHERE ${OWNER[owner]} = $2 AND slot = $3 AND replaced_at IS NULL`, [now(), ownerId, slot]);
      await t.run(
        `INSERT INTO photos (id, ${OWNER[owner]}, kind, slot, blob_id, content_type, size_bytes, damage_note, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [newId(), ownerId, kind, slot, blobId, file.type, file.buf.length, kind === "checkin" ? note : null, user.id, now()],
      );
    });
    return forOwner(db, owner, ownerId);
  }
  async function setDamage(owner, ownerId, slot, b) {
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) || null : null;
    const r = await db.run(`UPDATE photos SET damage_note = $1 WHERE ${OWNER[owner]} = $2 AND slot = $3 AND kind = 'checkin' AND replaced_at IS NULL`, [note, ownerId, String(slot)]);
    if (!r.changes) throw bad("slot", "Take that photo first.");
    return forOwner(db, owner, ownerId);
  }

  // Photos attached to a damage claim or a warranty return (stored like incident photos).
  const ATTACH = { claim: "claim_id", warranty: "warranty_id" };
  function decodeAll(list, field, { min = 0, max = 4, minMsg } = {}) {
    const arr = Array.isArray(list) ? list : [];
    if (arr.length > max) throw bad(field, `Add up to ${max} photos.`);
    if (arr.length < min) throw bad(field, minMsg || "Add at least one photo.");
    return arr.map((p) => decode(p, field));
  }
  async function attach(t, owner, ownerId, files, user) {
    for (const [i, f] of files.entries()) {
      const blobId = await storeBlob(t, f);
      await t.run(`INSERT INTO photos (id, ${ATTACH[owner]}, kind, slot, blob_id, content_type, size_bytes, uploaded_by, created_at) VALUES ($1, $2, 'incident', $3, $4, $5, $6, $7, $8)`,
        [newId(), ownerId, `p${i}`, blobId, f.type, f.buf.length, user.id, now()]);
    }
  }
  async function attached(q, owner, ownerId) {
    return (await q.all(`SELECT * FROM photos WHERE ${ATTACH[owner]} = $1 AND replaced_at IS NULL ORDER BY slot`, [ownerId])).map(photoOut);
  }

  const api = {
    CHECKIN_SLOTS, AFTER_SLOTS, forJob, forOwner, link, saveSlot, setDamage, decodeAll, attach, attached,

    // Missing proof for a step, or null when it's all there.
    async missing(jobId, kind, owner = "job") {
      const p = await forOwner(db, owner, jobId);
      const need = kind === "checkin" ? p.checkinNeeded : p.afterNeeded;
      return need.length ? need.map((n) => n.label) : null;
    },

    async upload(user, jobId, b) {
      const job = await partnerJob(user, jobId);
      return saveSlot("job", job.id, user, b, {
        allow: (kind) => {
          if (kind === "checkin" && job.status !== "arrived") throw new HttpError(409, "wrong_step", job.status === "in_progress" ? "Check-in photos are locked once work starts." : "Take check-in photos after you tap I've arrived.");
          if (kind === "after" && job.status !== "in_progress") throw new HttpError(409, "wrong_step", "Take after photos while you're working, before you complete the job.");
        },
      });
    },

    // Existing damage the partner saw at check-in. The customer sees it in their service record.
    async noteDamage(user, jobId, slot, b) {
      const job = await partnerJob(user, jobId);
      if (job.status !== "arrived") throw new HttpError(409, "wrong_step", "Damage notes are part of check-in, before work starts.");
      return setDamage("job", job.id, slot, b);
    },

    // Serves a photo when the signed link is valid.
    async file(id, exp, sig) {
      const e = Number(exp);
      if (!Number.isFinite(e) || e < now() || typeof sig !== "string") throw new HttpError(403, "link_expired", "This photo link expired. Go back and open it again.");
      const want = Buffer.from(sign(String(id), e));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpError(403, "bad_link", "This photo link isn't valid.");
      const row = await db.get(`SELECT b.content_type, b.data FROM photos p JOIN blobs b ON b.id = p.blob_id WHERE p.id = $1`, [String(id)]);
      if (!row) throw new HttpError(404, "not_found", "That photo doesn't exist.");
      return { contentType: row.content_type, bytes: Buffer.from(row.data, "base64") };
    },

    // ---------- Service history: every finished visit for one vehicle ----------
    async history(user, vehicleId) {
      const v = await db.get(`SELECT * FROM vehicles WHERE id = $1 AND user_id = $2`, [String(vehicleId), user.id]);
      if (!v) throw new HttpError(404, "not_found", "That vehicle isn't on your account.");
      const jobs = await db.all(`SELECT * FROM jobs WHERE vehicle_id = $1 AND customer_id = $2 AND status = 'completed' ORDER BY completed_at DESC LIMIT 100`, [v.id, user.id]);
      const out = [];
      for (const j of jobs) {
        const partner = j.partner_id ? await db.get(`SELECT first_name, last_name FROM users WHERE id = $1`, [j.partner_id]) : null;
        const final = J(j.final, {});
        out.push({
          jobId: j.id, completedAt: j.completed_at, odometer: j.odometer_in,
          services: (final.lines || []).map((l) => l.name || (serviceById(l.serviceId) || {}).name),
          totalCents: final.chargeCents, inspection: J(j.inspection), notes: j.work_notes,
          partner: partner ? `${partner.first_name} ${partner.last_name ? `${partner.last_name[0]}.` : ""}`.trim() : null,
          warrantyUntil: j.warranty_until, warrantyMilesUntil: j.warranty_miles_until,
          photos: await forJob(db, j.id),
        });
      }
      return { vehicle: { id: v.id, year: v.year, make: v.make, model: v.model, mileage: v.mileage }, visits: out };
    },

    // ---------- Incident reports (partner agreement: report damage within 24 hours) ----------
    async report(user, b) {
      const type = String(b.type || "");
      if (!INCIDENT_TYPES[type]) throw bad("type", "Choose what happened.");
      const description = typeof b.description === "string" ? b.description.trim() : "";
      if (description.length < 15) throw bad("description", "Describe what happened in a couple of sentences.");
      if (description.length > 2000) throw bad("description", "Keep it under 2,000 characters.");
      const photos = Array.isArray(b.photos) ? b.photos : [];
      if (photos.length > 4) throw bad("photos", "Add up to 4 photos.");
      if (type.endsWith("_damage") && !photos.length) throw bad("photos", "Add at least one photo of the damage.");
      const files = photos.map((p) => decode(p, "photos"));
      let job = null;
      if (b.jobId) {
        job = await db.get(`SELECT * FROM jobs WHERE id = $1 AND partner_id = $2`, [String(b.jobId), user.id]);
        if (!job) throw bad("jobId", "Pick one of your jobs.");
      }
      const id = newId();
      await db.tx(async (t) => {
        await t.run(`INSERT INTO incidents (id, reporter_id, job_id, type, description, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [id, user.id, job ? job.id : null, type, description, now()]);
        for (const [i, f] of files.entries()) {
          const blobId = await storeBlob(t, f);
          await t.run(`INSERT INTO photos (id, incident_id, kind, slot, blob_id, content_type, size_bytes, uploaded_by, created_at) VALUES ($1, $2, 'incident', $3, $4, $5, $6, $7, $8)`,
            [newId(), id, `p${i}`, blobId, f.type, f.buf.length, user.id, now()]);
        }
        if (job) await t.run(`INSERT INTO job_events (id, job_id, actor_id, kind, data, created_at) VALUES ($1, $2, $3, 'incident_reported', $4, $5)`,
          [`${String(now()).padStart(15, "0")}-${newId().slice(0, 8)}`, job.id, user.id, JSON.stringify({ incidentId: id, type }), now()]);
      });
      return api.incident(id);
    },
    // Jobs a partner can report on: active ones, and ones that ended in the last 3 days.
    async reportableJobs(user) {
      const rows = await db.all(`SELECT id, service_ids, window_start, status, completed_at, cancelled_at FROM jobs WHERE partner_id = $1 ORDER BY window_start DESC LIMIT 30`, [user.id]);
      return rows.filter((j) => ["confirmed", "en_route", "arrived", "in_progress"].includes(j.status) || (j.completed_at || j.cancelled_at || 0) > now() - 3 * DAY)
        .map((j) => ({ id: j.id, when: j.window_start, status: j.status, services: J(j.service_ids, []).map((s) => (serviceById(s) || {}).name) }));
    },
    async incident(id) {
      const r = await db.get(`SELECT * FROM incidents WHERE id = $1`, [id]);
      if (!r) throw new HttpError(404, "not_found", "That report doesn't exist.");
      const photos = await db.all(`SELECT * FROM photos WHERE incident_id = $1 ORDER BY slot`, [id]);
      const who = await db.get(`SELECT first_name, last_name FROM users WHERE id = $1`, [r.reporter_id]);
      return { id: r.id, reporterId: r.reporter_id, reporter: who ? `${who.first_name} ${who.last_name}` : null, jobId: r.job_id, type: r.type, typeLabel: INCIDENT_TYPES[r.type], description: r.description, status: r.status, staffNote: r.staff_note, createdAt: r.created_at, photos: photos.map(photoOut) };
    },
    async myIncidents(user) {
      const rows = await db.all(`SELECT id FROM incidents WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 50`, [user.id]);
      return Promise.all(rows.map((r) => api.incident(r.id)));
    },
    async allIncidents(status) {
      const rows = await db.all(`SELECT id FROM incidents WHERE ($1 = '' OR status = $1) ORDER BY created_at DESC LIMIT 200`, [status || ""]);
      return Promise.all(rows.map((r) => api.incident(r.id)));
    },
    async closeIncident(staff, id, b) {
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 1000) : "";
      if (note.length < 5) throw bad("note", "Say how it was resolved.");
      const r = await db.run(`UPDATE incidents SET status = 'closed', staff_note = $1, closed_at = $2 WHERE id = $3`, [note, now(), String(id)]);
      if (!r.changes) throw new HttpError(404, "not_found", "That report doesn't exist.");
      return api.incident(String(id));
    },
  };
  return api;
}
