// Services partners can offer. Names match the prototypes. Pricing for each comes in step 5.
// needsProof: partners must have proof on file before they get these jobs (RULES.md, Fleet section):
// brake work, glass, DOT inspections, and washing (water containment). Proof uploads come in step 9.

export const CATEGORIES = [
  { id: "maintenance", name: "Maintenance" },
  { id: "quick_fixes", name: "Quick fixes" },
  { id: "detailing", name: "Detailing" },
  { id: "roadside", name: "Roadside, gas & charging" },
  { id: "glass", name: "Glass" },
  { id: "fleet", name: "Fleet & DOT" },
];

export const SERVICES = [
  { id: "oil_change", category: "maintenance", name: "Oil change" },
  { id: "filter_change", category: "maintenance", name: "Filter change" },
  { id: "tire_rotation", category: "maintenance", name: "Tire rotation" },
  { id: "spark_plugs", category: "maintenance", name: "Spark plugs" },
  { id: "air_filters", category: "maintenance", name: "Air filters" },
  { id: "brakes", category: "maintenance", name: "Brakes", needsProof: true },
  { id: "battery_test", category: "maintenance", name: "Battery test" },
  { id: "diagnostics", category: "maintenance", name: "Diagnostics" },
  { id: "ac_service", category: "maintenance", name: "A/C service" },

  { id: "quick_bulbs", category: "quick_fixes", name: "Bulbs (headlight, brake, tail)" },
  { id: "quick_wipers", category: "quick_fixes", name: "Wiper blades" },
  { id: "quick_fluids", category: "quick_fixes", name: "Fluid check & top-off" },
  { id: "quick_cabin_filter", category: "quick_fixes", name: "Cabin filter" },
  { id: "quick_battery", category: "quick_fixes", name: "Battery replacement" },
  { id: "quick_tpms", category: "quick_fixes", name: "TPMS reset" },
  { id: "quick_tire_plug", category: "quick_fixes", name: "Tire plug" },
  { id: "quick_fuse", category: "quick_fixes", name: "Fuse replacement" },
  { id: "quick_key_fob", category: "quick_fixes", name: "Key fob battery" },
  { id: "quick_code_scan", category: "quick_fixes", name: "Code scan" },
  { id: "quick_headlight_restore", category: "quick_fixes", name: "Headlight restoration" },
  { id: "quick_serpentine", category: "quick_fixes", name: "Serpentine belt" },

  { id: "exterior_wash", category: "detailing", name: "Exterior wash", needsProof: true },
  { id: "interior_detail", category: "detailing", name: "Interior detail" },
  { id: "full_detail", category: "detailing", name: "Full detail", needsProof: true },
  { id: "ceramic_coat", category: "detailing", name: "Ceramic coat" },

  { id: "jump_start", category: "roadside", name: "Jump start" },
  { id: "flat_tire", category: "roadside", name: "Flat tire change" },
  { id: "lockout", category: "roadside", name: "Lockout" },
  { id: "fuel_delivery", category: "roadside", name: "Fuel delivery" },
  { id: "ev_charge", category: "roadside", name: "Mobile EV charge" },

  { id: "glass_chip", category: "glass", name: "Windshield chip repair", needsProof: true },
  { id: "glass_windshield", category: "glass", name: "Windshield replacement", needsProof: true },
  { id: "glass_side", category: "glass", name: "Side or door glass", needsProof: true },
  { id: "glass_adas", category: "glass", name: "ADAS camera calibration", needsProof: true },

  { id: "dot_annual", category: "fleet", name: "DOT annual inspection", needsProof: true },
  { id: "dot_brake", category: "fleet", name: "Brake inspection & adjustment", needsProof: true },
  { id: "dot_dvir", category: "fleet", name: "DVIR defect repair & sign-off", needsProof: true },
  { id: "fleet_wash", category: "fleet", name: "Fleet washing", needsProof: true },
];

const BY_ID = new Map(SERVICES.map((s) => [s.id, s]));
export const serviceById = (id) => BY_ID.get(id) || null;
export const publicService = (s) => ({ id: s.id, category: s.category, name: s.name, needsProof: !!s.needsProof });
