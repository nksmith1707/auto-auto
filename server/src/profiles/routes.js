// Step 4: profile edits, customer vehicles and saved places, partner service area and services.
import { readJson, send, HttpError } from "../lib/http.js";
import { checker } from "../lib/validate.js";
import { createLimiter } from "../lib/ratelimit.js";
import { requireUser } from "../auth/routes.js";
import { newId } from "../auth/tokens.js";
import { vinProblem } from "../vehicles/vin.js";
import { CATEGORIES, SERVICES, serviceById, publicService } from "../catalog/services.js";
import { addressLine } from "../maps/geo.js";

const MAX_VEHICLES = 10;
const MAX_PLACES = 10;
const FUELS = ["gas", "diesel", "hybrid", "electric"];
const OILS = ["Full synthetic 0W-20", "Full synthetic 5W-20", "Full synthetic 5W-30", "Synthetic blend", "Conventional", "High mileage", "Diesel 15W-40", "Not sure"];
const PARKING = ["driveway", "street", "lot", "garage", "other"];
const RADIUS = { min: 5, max: 60, step: 5 };

const notFound = (what) => new HttpError(404, "not_found", `That ${what} isn't on your account. Pull to refresh and try again.`);

export function vehicleOut(v) {
  return {
    id: v.id, year: v.year, make: v.make, model: v.model, trim: v.trim, vin: v.vin, plate: v.plate, plateState: v.plate_state,
    color: v.color, mileage: v.mileage, fuel: v.fuel, oilPreference: v.oil_preference, nickname: v.nickname,
    insurer: v.insurer, policyNumber: v.policy_number, createdAt: v.created_at, updatedAt: v.updated_at,
  };
}

// Full place, for its owner only.
export function placeOut(p) {
  return {
    id: p.id, label: p.label, street: p.street, unit: p.unit, city: p.city, state: p.state, zip: p.zip,
    parking: p.parking, notes: p.notes, isDefault: !!p.is_default, area: placeArea(p), createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

// What a partner may see before Start Trip: general area only.
export const placeArea = (p) => `${p.city}, ${p.state} ${p.zip}`;

function areaOut(a) {
  if (!a) return null;
  return { street: a.street, city: a.city, state: a.state, zip: a.zip, radiusMiles: a.radius_miles, onMap: a.geo_status === "ok", updatedAt: a.updated_at };
}

export function profileRoutes(router, { db, auth, vinDecode, geocode = null, now = () => Date.now() }) {
  // Finds an address on the map. A definite "not found" is shown to the person; a Google outage isn't
  // (the address saves and is looked up again when it's needed).
  async function locate(addr, field) {
    if (!geocode) return { lat: null, lng: null, geo_status: null };
    const g = await geocode(addressLine(addr));
    if (g.status === "not_found") {
      throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { [field]: "We couldn't find that address on the map. Check the street number, street name, and ZIP code." } });
    }
    return g.status === "ok" ? { lat: g.lat, lng: g.lng, geo_status: "ok" } : { lat: null, lng: null, geo_status: "error" };
  }

  const vinLimiter = createLimiter({ limit: 30, windowMs: 60 * 60_000 });

  // ---------- Profile ----------
  router.patch("/v1/me", async (req, res) => {
    const s = await requireUser(req, auth);
    const b = await readJson(req);
    const c = checker();
    const sets = {};
    if ("firstName" in b) sets.first_name = c.name("firstName", b.firstName, "first name");
    if ("lastName" in b) sets.last_name = c.name("lastName", b.lastName, "last name");
    if ("phone" in b) sets.phone = c.phone("phone", b.phone, { required: s.user.role === "partner" });
    if ("email" in b) c.add("email", "Email changes aren't available in the app yet. Contact support to change your email.");
    c.done();
    if (Object.keys(sets).length) {
      const cols = Object.keys(sets);
      await db.run(
        `UPDATE users SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${cols.length + 1} WHERE id = $${cols.length + 2}`,
        [...cols.map((k) => sets[k]), now(), s.user.id],
      );
    }
    const u = await db.get(`SELECT * FROM users WHERE id = $1`, [s.user.id]);
    send(res, 200, { user: await auth.publicUser(u) });
  });

  // ---------- Catalog ----------
  router.get("/v1/catalog/services", async (req, res) => {
    await requireUser(req, auth);
    send(res, 200, { categories: CATEGORIES, services: SERVICES.map(publicService) });
  });

  // ---------- VIN ----------
  router.get("/v1/vin/:vin", async (req, res) => {
    const s = await requireUser(req, auth, ["customer", "admin"]);
    const wait = vinLimiter.hit(s.user.id);
    if (wait) throw new HttpError(429, "too_many_attempts", `Too many VIN lookups. Wait ${Math.ceil(wait / 60)} minutes and try again, or fill in the details yourself.`, { retryAfter: wait });
    const { vin, problem } = vinProblem(req.params.vin);
    if (problem) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { vin: problem } });
    const d = await vinDecode(vin);
    send(res, 200, {
      vin: d,
      message: !d.checkDigitOk
        ? "This VIN doesn't add up. One character is probably wrong. Check it against the windshield or driver's door jamb."
        : d.model ? "Found it. Check the details below." : "The VIN looks right, but we couldn't look up the model. Fill in the rest yourself.",
    });
  });

  // ---------- Vehicles (customers) ----------
  function readVehicle(b, { partial = false } = {}) {
    const c = checker();
    const out = {};
    const has = (k) => !partial || k in b;
    const thisYear = new Date(now()).getFullYear();
    if (has("year")) out.year = c.int("year", b.year, { min: 1981, max: thisYear + 2, label: "the model year", required: true });
    if (has("make")) out.make = c.text("make", b.make, { label: "the make", max: 40, required: true });
    if (has("model")) out.model = c.text("model", b.model, { label: "the model", max: 40, required: true });
    if (has("trim")) out.trim = c.text("trim", b.trim, { label: "the trim", max: 40 });
    if (has("vin")) {
      if (b.vin == null || b.vin === "") out.vin = null;
      else { const v = vinProblem(b.vin); if (v.problem) c.add("vin", v.problem); out.vin = v.vin; }
    }
    if (has("plate")) {
      const p = c.text("plate", b.plate, { label: "the plate", max: 10 });
      if (p && !/^[A-Za-z0-9 -]+$/.test(p)) c.add("plate", "Use only letters, numbers, spaces, and dashes in the plate.");
      out.plate = p ? p.toUpperCase() : null;
    }
    if (has("plateState")) out.plate_state = c.usState("plateState", b.plateState, { required: false });
    if (has("color")) out.color = c.text("color", b.color, { label: "the color", max: 30 });
    if (has("mileage")) out.mileage = c.int("mileage", b.mileage, { min: 0, max: 1_500_000, label: "the mileage" });
    if (has("fuel")) {
      const f = typeof b.fuel === "string" ? b.fuel.toLowerCase() : b.fuel == null && !partial ? "gas" : b.fuel;
      out.fuel = c.oneOf("fuel", f, FUELS, "Choose gas, diesel, hybrid, or electric.");
    }
    if (has("oilPreference")) {
      if (b.oilPreference == null || b.oilPreference === "") out.oil_preference = null;
      else out.oil_preference = c.oneOf("oilPreference", b.oilPreference, OILS, "Pick an oil from the list.");
    }
    if (has("nickname")) out.nickname = c.text("nickname", b.nickname, { label: "the nickname", max: 30 });
    if (has("insurer")) out.insurer = c.text("insurer", b.insurer, { label: "the insurance company", max: 60 });
    if (has("policyNumber")) out.policy_number = c.text("policyNumber", b.policyNumber, { label: "the policy number", max: 40 });
    c.done();
    return out;
  }

  const vinTaken = () => new HttpError(409, "vin_taken", "You already have a vehicle with that VIN.", { fields: { vin: "You already have a vehicle with that VIN." } });
  const isUnique = (e) => /unique|duplicate/i.test(String(e.message));

  router.get("/v1/vehicles", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    const rows = await db.all(`SELECT * FROM vehicles WHERE user_id = $1 AND archived_at IS NULL ORDER BY created_at`, [s.user.id]);
    send(res, 200, { vehicles: rows.map(vehicleOut), options: { fuels: FUELS, oils: OILS } });
  });

  router.post("/v1/vehicles", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    const v = readVehicle(await readJson(req));
    const count = await db.get(`SELECT COUNT(*) AS n FROM vehicles WHERE user_id = $1 AND archived_at IS NULL`, [s.user.id]);
    if (Number(count.n) >= MAX_VEHICLES) throw new HttpError(422, "too_many", `You can have up to ${MAX_VEHICLES} vehicles. Remove one first, or set up a fleet account for more.`);
    const id = newId();
    const at = now();
    try {
      await db.run(
        `INSERT INTO vehicles (id, user_id, year, make, model, trim, vin, plate, plate_state, color, mileage, fuel, oil_preference, nickname, insurer, policy_number, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)`,
        [id, s.user.id, v.year, v.make, v.model, v.trim, v.vin, v.plate, v.plate_state, v.color, v.mileage, v.fuel, v.oil_preference, v.nickname, v.insurer, v.policy_number, at],
      );
    } catch (e) {
      if (isUnique(e)) throw vinTaken();
      throw e;
    }
    send(res, 201, { vehicle: vehicleOut(await db.get(`SELECT * FROM vehicles WHERE id = $1`, [id])) });
  });

  async function ownVehicle(s, id) {
    const v = await db.get(`SELECT * FROM vehicles WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [id, s.user.id]);
    if (!v) throw notFound("vehicle");
    return v;
  }

  router.get("/v1/vehicles/:id", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    send(res, 200, { vehicle: vehicleOut(await ownVehicle(s, req.params.id)) });
  });

  router.patch("/v1/vehicles/:id", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    const cur = await ownVehicle(s, req.params.id);
    const v = readVehicle(await readJson(req), { partial: true });
    const cols = Object.keys(v);
    if (cols.length) {
      try {
        await db.run(
          `UPDATE vehicles SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${cols.length + 1} WHERE id = $${cols.length + 2}`,
          [...cols.map((k) => v[k]), now(), cur.id],
        );
      } catch (e) {
        if (isUnique(e)) throw vinTaken();
        throw e;
      }
    }
    send(res, 200, { vehicle: vehicleOut(await db.get(`SELECT * FROM vehicles WHERE id = $1`, [cur.id])) });
  });

  router.delete("/v1/vehicles/:id", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    const cur = await ownVehicle(s, req.params.id);
    await db.run(`UPDATE vehicles SET archived_at = $1, updated_at = $1 WHERE id = $2`, [now(), cur.id]);
    send(res, 204);
  });

  // ---------- Saved places (customers) ----------
  function readPlace(b, { partial = false } = {}) {
    const c = checker();
    const out = {};
    const has = (k) => !partial || k in b;
    if (has("label")) out.label = c.text("label", b.label, { label: "a name for this place", max: 30, required: true });
    if (has("street")) out.street = c.text("street", b.street, { label: "the street address", max: 100, required: true });
    if (has("unit")) out.unit = c.text("unit", b.unit, { label: "the apartment or unit", max: 20 });
    if (has("city")) out.city = c.text("city", b.city, { label: "the city", max: 50, required: true });
    if (has("state")) out.state = c.usState("state", b.state);
    if (has("zip")) out.zip = c.zip("zip", b.zip);
    if (has("parking")) {
      if (b.parking == null || b.parking === "") out.parking = null;
      else out.parking = c.oneOf("parking", b.parking, PARKING, "Choose driveway, street, parking lot, garage, or other.");
    }
    if (has("notes")) out.notes = c.text("notes", b.notes, { label: "the notes", max: 300 });
    if ("isDefault" in b) {
      if (typeof b.isDefault !== "boolean") c.add("isDefault", "Choose yes or no.");
      out.is_default = b.isDefault ? 1 : 0;
    }
    c.done();
    return out;
  }

  router.get("/v1/places", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    const rows = await db.all(`SELECT * FROM places WHERE user_id = $1 AND archived_at IS NULL ORDER BY is_default DESC, created_at`, [s.user.id]);
    send(res, 200, { places: rows.map(placeOut), options: { parking: PARKING } });
  });

  router.post("/v1/places", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    const p = readPlace(await readJson(req));
    const geo = await locate(p, "street");
    const out = await db.tx(async (t) => {
      const count = Number((await t.get(`SELECT COUNT(*) AS n FROM places WHERE user_id = $1 AND archived_at IS NULL`, [s.user.id])).n);
      if (count >= MAX_PLACES) throw new HttpError(422, "too_many", `You can save up to ${MAX_PLACES} places. Remove one first.`);
      // The first place is the default. A new default replaces the old one.
      const def = count === 0 || p.is_default === 1 ? 1 : 0;
      if (def) await t.run(`UPDATE places SET is_default = 0 WHERE user_id = $1`, [s.user.id]);
      const id = newId();
      const at = now();
      await t.run(
        `INSERT INTO places (id, user_id, label, street, unit, city, state, zip, parking, notes, is_default, lat, lng, geo_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
        [id, s.user.id, p.label, p.street, p.unit, p.city, p.state, p.zip, p.parking, p.notes, def, geo.lat, geo.lng, geo.geo_status, at],
      );
      return t.get(`SELECT * FROM places WHERE id = $1`, [id]);
    });
    send(res, 201, { place: placeOut(out) });
  });

  async function ownPlace(t, s, id) {
    const p = await t.get(`SELECT * FROM places WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [id, s.user.id]);
    if (!p) throw notFound("place");
    return p;
  }

  router.patch("/v1/places/:id", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    const p = readPlace(await readJson(req), { partial: true });
    // A changed address is looked up on the map again.
    if (["street", "city", "state", "zip"].some((k) => k in p)) {
      const before = await ownPlace(db, s, req.params.id);
      const merged = { ...before, ...p };
      if (["street", "city", "state", "zip"].some((k) => merged[k] !== before[k])) Object.assign(p, await locate(merged, "street"));
    }
    const out = await db.tx(async (t) => {
      const cur = await ownPlace(t, s, req.params.id);
      if (p.is_default === 0 && cur.is_default) delete p.is_default; // Make another place the default instead.
      if (p.is_default === 1) await t.run(`UPDATE places SET is_default = 0 WHERE user_id = $1`, [s.user.id]);
      const cols = Object.keys(p);
      if (cols.length) {
        await t.run(
          `UPDATE places SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${cols.length + 1} WHERE id = $${cols.length + 2}`,
          [...cols.map((k) => p[k]), now(), cur.id],
        );
      }
      return t.get(`SELECT * FROM places WHERE id = $1`, [cur.id]);
    });
    send(res, 200, { place: placeOut(out) });
  });

  router.delete("/v1/places/:id", async (req, res) => {
    const s = await requireUser(req, auth, ["customer"]);
    await db.tx(async (t) => {
      const cur = await ownPlace(t, s, req.params.id);
      const at = now();
      await t.run(`UPDATE places SET archived_at = $1, is_default = 0, updated_at = $1 WHERE id = $2`, [at, cur.id]);
      if (cur.is_default) {
        // Hand the default to the oldest remaining place.
        const next = await t.get(`SELECT id FROM places WHERE user_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, [s.user.id]);
        if (next) await t.run(`UPDATE places SET is_default = 1, updated_at = $1 WHERE id = $2`, [at, next.id]);
      }
    });
    send(res, 204);
  });

  // ---------- Partner service area ----------
  router.get("/v1/partner/service-area", async (req, res) => {
    const s = await requireUser(req, auth, ["partner"]);
    const a = await db.get(`SELECT * FROM partner_service_areas WHERE user_id = $1`, [s.user.id]);
    send(res, 200, { serviceArea: areaOut(a), limits: { minMiles: RADIUS.min, maxMiles: RADIUS.max, stepMiles: RADIUS.step } });
  });

  router.put("/v1/partner/service-area", async (req, res) => {
    const s = await requireUser(req, auth, ["partner"]);
    const b = await readJson(req);
    const c = checker();
    const street = c.text("street", b.street, { label: "your home base street address", max: 100, required: true });
    const city = c.text("city", b.city, { label: "the city", max: 50, required: true });
    const state = c.usState("state", b.state);
    const zip = c.zip("zip", b.zip);
    const r = c.int("radiusMiles", b.radiusMiles, { min: RADIUS.min, max: RADIUS.max, label: "your travel radius", required: true });
    if (r != null && r % RADIUS.step) c.add("radiusMiles", `Pick a radius in steps of ${RADIUS.step} miles.`);
    c.done();
    const prev = await db.get(`SELECT * FROM partner_service_areas WHERE user_id = $1`, [s.user.id]);
    const same = prev && prev.street === street && prev.city === city && prev.state === state && prev.zip === zip && prev.geo_status === "ok";
    const geo = same ? { lat: prev.lat, lng: prev.lng, geo_status: "ok" } : await locate({ street, city, state, zip }, "street");
    const at = now();
    await db.run(
      `INSERT INTO partner_service_areas (user_id, street, city, state, zip, radius_miles, lat, lng, geo_status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (user_id) DO UPDATE SET street = excluded.street, city = excluded.city, state = excluded.state, zip = excluded.zip,
         radius_miles = excluded.radius_miles, lat = excluded.lat, lng = excluded.lng, geo_status = excluded.geo_status, updated_at = excluded.updated_at`,
      [s.user.id, street, city, state, zip, r, geo.lat, geo.lng, geo.geo_status, at],
    );
    send(res, 200, { serviceArea: areaOut(await db.get(`SELECT * FROM partner_service_areas WHERE user_id = $1`, [s.user.id])) });
  });

  // ---------- Partner services ----------
  async function partnerServices(userId) {
    const rows = await db.all(`SELECT service_id FROM partner_services WHERE user_id = $1`, [userId]);
    return rows.map((r) => serviceById(r.service_id)).filter(Boolean).map(publicService);
  }

  router.get("/v1/partner/services", async (req, res) => {
    const s = await requireUser(req, auth, ["partner"]);
    send(res, 200, { services: await partnerServices(s.user.id), catalog: { categories: CATEGORIES, services: SERVICES.map(publicService) } });
  });

  router.put("/v1/partner/services", async (req, res) => {
    const s = await requireUser(req, auth, ["partner"]);
    const b = await readJson(req);
    const ids = b.serviceIds;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
      throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { serviceIds: "Send the list of services you offer." } });
    }
    const unique = [...new Set(ids)];
    const unknown = unique.filter((x) => !serviceById(x));
    if (unknown.length) throw new HttpError(422, "invalid_input", "Some fields need fixing.", { fields: { serviceIds: `We don't offer ${unknown.length === 1 ? "that service" : "some of those services"} yet. Update the app and try again.` } });
    await db.tx(async (t) => {
      await t.run(`DELETE FROM partner_services WHERE user_id = $1`, [s.user.id]);
      const at = now();
      for (const id of unique) await t.run(`INSERT INTO partner_services (user_id, service_id, created_at) VALUES ($1, $2, $3)`, [s.user.id, id, at]);
    });
    send(res, 200, { services: await partnerServices(s.user.id) });
  });
}
