// VIN checks and decoding.
// Local rules always run (length, letters, check digit, model year, maker from the first 3 characters).
// When a lookup function is given, details (model, trim, engine, fuel) come from NHTSA's free vPIC service
// and are cached in vin_decodes so each VIN is looked up once.

const TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

// Common makers by World Manufacturer Identifier, used when the NHTSA lookup isn't available.
const WMI = {
  "1HG": "Honda", "2HG": "Honda", "5FN": "Honda", "5FP": "Honda", "19X": "Honda", "JHM": "Honda", "SHH": "Honda", "5J6": "Honda",
  "1FA": "Ford", "1FT": "Ford", "1FM": "Ford", "3FA": "Ford", "1FD": "Ford", "1G1": "Chevrolet", "1GC": "Chevrolet", "1GN": "Chevrolet",
  "3GN": "Chevrolet", "2GN": "Chevrolet", "1GT": "GMC", "3GT": "GMC", "1GK": "GMC", "2T1": "Toyota", "4T1": "Toyota", "4T3": "Toyota",
  "5TD": "Toyota", "5TF": "Toyota", "JTD": "Toyota", "JTM": "Toyota", "JTE": "Toyota", "5YJ": "Tesla", "7SA": "Tesla", "1C4": "Jeep",
  "1J4": "Jeep", "1C6": "Ram", "3C6": "Ram", "2C3": "Chrysler", "2C4": "Chrysler", "3VW": "Volkswagen", "3VV": "Volkswagen", "WVW": "Volkswagen",
  "1VW": "Volkswagen", "WBA": "BMW", "5UX": "BMW", "WDD": "Mercedes-Benz", "4JG": "Mercedes-Benz", "W1K": "Mercedes-Benz",
  "JN1": "Nissan", "1N4": "Nissan", "5N1": "Nissan", "3N1": "Nissan", "KMH": "Hyundai", "5NP": "Hyundai", "KND": "Kia", "5XY": "Kia",
  "JF1": "Subaru", "JF2": "Subaru", "4S4": "Subaru", "4S3": "Subaru", "JM1": "Mazda", "JM3": "Mazda", "WAU": "Audi", "YV1": "Volvo",
  "1LN": "Lincoln", "2LM": "Lincoln", "5LM": "Lincoln", "1GY": "Cadillac", "KNA": "Kia", "JA4": "Mitsubishi", "5UM": "BMW",
};

export function cleanVin(raw) {
  return String(raw || "").toUpperCase().replace(/[\s-]/g, "");
}

export function checkDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    if (v === undefined) return null;
    sum += v * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

// Returns { ok, vin, problem } for format checks. problem is a plain-English message.
export function vinProblem(raw) {
  const vin = cleanVin(raw);
  if (!vin) return { vin, problem: "Enter the VIN." };
  if (/[^A-Z0-9]/.test(vin)) return { vin, problem: "A VIN has only letters and numbers." };
  if (vin.length !== 17) return { vin, problem: `A VIN has 17 characters. This one has ${vin.length}. Check the windshield or the driver's door jamb.` };
  if (/[IOQ]/.test(vin)) return { vin, problem: "VINs never use the letters I, O, or Q. Check for a 1 or 0 instead." };
  return { vin, problem: null };
}

// Decodes what the VIN itself says. Model year codes repeat every 30 years; position 7 being a letter
// means 2010 or later for cars and light trucks.
export function localDecode(vin) {
  const cd = checkDigit(vin);
  const yi = YEAR_CODES.indexOf(vin[9]);
  let year = yi < 0 ? null : 1980 + yi;
  if (year && /[A-Z]/.test(vin[6]) && year + 30 <= new Date().getFullYear() + 1) year += 30;
  return {
    vin,
    checkDigitOk: cd === vin[8],
    year,
    make: WMI[vin.slice(0, 3)] || null,
    model: null, trim: null, fuel: null, engine: null, bodyClass: null,
    source: "vin",
  };
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bBmw\b/, "BMW").replace(/\bGmc\b/, "GMC");

export function fromVpic(r) {
  const s = (k) => (r && typeof r[k] === "string" && r[k].trim() ? r[k].trim() : null);
  const fuelP = (s("FuelTypePrimary") || "").toLowerCase();
  const elec = (s("ElectrificationLevel") || "").toLowerCase();
  const fuel = elec.includes("hybrid") || elec.includes("phev") || elec.includes("hev") ? "hybrid"
    : fuelP.includes("electric") || elec.includes("bev") ? "electric"
    : fuelP.includes("diesel") ? "diesel"
    : fuelP.includes("gasoline") || fuelP.includes("flex") ? "gas" : null;
  const disp = s("DisplacementL");
  const cyl = s("EngineCylinders");
  const engine = disp ? `${Number(disp).toFixed(1)}L${cyl ? ` ${cyl}-cyl` : ""}` : null;
  const year = Number(s("ModelYear")) || null;
  return {
    make: s("Make") ? titleCase(s("Make")) : null,
    model: s("Model"),
    trim: s("Trim") || s("Series"),
    year,
    fuel,
    engine,
    bodyClass: s("BodyClass"),
  };
}

// fetchImpl(url, opts) → Response. Returns the merged decode. Never throws for lookup problems.
export function createVinDecoder({ db, fetchImpl, now = () => Date.now(), timeoutMs = 6000, log = () => {} }) {
  return async function decode(vin) {
    const base = localDecode(vin);
    if (!fetchImpl) return base;
    const cached = await db.get(`SELECT data FROM vin_decodes WHERE vin = $1`, [vin]);
    let details = cached ? JSON.parse(cached.data) : null;
    if (!details) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (res.ok) {
          const body = await res.json();
          const r = body && Array.isArray(body.Results) ? body.Results[0] : null;
          if (r) {
            details = fromVpic(r);
            // Only cache real answers, so a bad day at NHTSA doesn't stick.
            if (details.make && details.model) {
              await db.run(`INSERT INTO vin_decodes (vin, data, created_at) VALUES ($1, $2, $3) ON CONFLICT (vin) DO NOTHING`, [vin, JSON.stringify(details), now()]);
            }
          }
        }
      } catch (e) {
        log(`[vin] lookup failed for ${vin.slice(0, 11)}…: ${e.name === "AbortError" ? "timeout" : e.message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!details || !details.make) return base;
    return {
      ...base,
      year: details.year || base.year,
      make: details.make || base.make,
      model: details.model, trim: details.trim, fuel: details.fuel, engine: details.engine, bodyClass: details.bodyClass,
      source: "nhtsa",
    };
  };
}
