// Map helpers. Addresses become map locations through Google's Geocoding API (needs GOOGLE_MAPS_API_KEY).
// Distances are straight-line miles, which cost nothing; drive times can use Google's Routes API later.

const EARTH_MILES = 3958.8;

export function milesBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}

// Rough drive time for the app (the prototype uses about 2.2 minutes per mile around Knoxville).
export const driveMinutes = (miles) => (miles == null ? null : Math.max(5, Math.round(miles * 2.2)));

export const addressLine = (p) => [p.street, p.city, `${p.state} ${p.zip}`, "USA"].filter(Boolean).join(", ");

// Returns a geocoder, or null when no API key is set (local development and tests without a fake).
// geocode(address) → { status: "ok", lat, lng } | { status: "not_found" } | { status: "error", message }
export function createGeocoder({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000, log = () => {}, baseUrl = "https://maps.googleapis.com" }) {
  if (!apiKey || !fetchImpl) return null;
  return async function geocode(address) {
    const url = `${baseUrl}/maps/api/geocode/json?address=${encodeURIComponent(address)}&components=country:US&key=${encodeURIComponent(apiKey)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal });
      const body = await res.json();
      if (body.status === "OK" && body.results && body.results[0]) {
        const r = body.results[0];
        // A match on just the city or ZIP isn't good enough to send someone to.
        if (r.partial_match && !["street_address", "premise", "subpremise", "route"].some((t) => (r.types || []).includes(t))) return { status: "not_found" };
        return { status: "ok", lat: r.geometry.location.lat, lng: r.geometry.location.lng };
      }
      if (body.status === "ZERO_RESULTS") return { status: "not_found" };
      log(`[maps] geocode failed: ${body.status}${body.error_message ? ` ${body.error_message}` : ""}`);
      return { status: "error", message: body.status };
    } catch (e) {
      log(`[maps] geocode failed: ${e.name === "AbortError" ? "timeout" : e.message}`);
      return { status: "error", message: e.message };
    } finally {
      clearTimeout(timer);
    }
  };
}

// Hides phone numbers and email addresses in chat so real contact details are never shared (RULES.md, Dispatch).
export function maskContacts(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email hidden]")
    .replace(/(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g, "[number hidden]");
}
