// How each service is priced, in dollars. These are the prototype's SAMPLE book times and parts costs.
// Replace them with licensed repair data (book times per exact vehicle) once that provider is chosen (RULES.md, "Not decided yet").
//
// kinds:
//   book   — labor = book hours × labor rate; parts = estimated parts cost + tiered markup (fluids use the fluid markup)
//   quick  — flat labor; parts at cost + quick-fix markup (RULES.md: quick fixes, under an hour)
//   fixed  — one set price; `parts` is the part of it reimbursed to the partner at cost (the rest is labor)
//   diag   — the Diagnose It visit; price comes from the `diag` setting
//   glass  — quoted by the partner from the real glass cost; `typical` is the installed price range shown before a quote
//   fleet  — fleet accounts only; hours and parts by vehicle class [van/pickup, box truck, tractor, trailer], null = not offered

export const RATES = {
  oil_change: { kind: "book", hours: 0.4, parts: 31, fluid: true },
  filter_change: { kind: "book", hours: 0.2, parts: 9 },
  tire_rotation: { kind: "book", hours: 0.4, parts: 0 },
  spark_plugs: { kind: "book", hours: 1.0, parts: 40 },
  air_filters: { kind: "book", hours: 0.2, parts: 16 },
  brakes: { kind: "book", hours: 1.5, parts: 150 },
  battery_test: { kind: "book", hours: 0.3, parts: 0 },
  diagnostics: { kind: "diag" },
  ac_service: { kind: "fixed", price: 140, parts: 0 },

  quick_headlight_bulb: { kind: "quick", labor: 25, parts: 24 },
  quick_tail_bulb: { kind: "quick", labor: 15, parts: 8 },
  quick_wipers: { kind: "quick", labor: 10, parts: 28 },
  quick_fluids: { kind: "quick", labor: 20, parts: 0 },
  quick_cabin_filter: { kind: "quick", labor: 15, parts: 18 },
  quick_battery: { kind: "quick", labor: 35, parts: 150 },
  quick_tpms: { kind: "quick", labor: 20, parts: 0 },
  quick_tire_plug: { kind: "quick", labor: 30, parts: 0 },
  quick_fuse: { kind: "quick", labor: 15, parts: 0 },
  quick_key_fob: { kind: "quick", labor: 10, parts: 0 },
  quick_code_scan: { kind: "quick", labor: 30, parts: 0 },
  quick_headlight_restore: { kind: "quick", labor: 60, parts: 0 },
  quick_serpentine: { kind: "quick", labor: 55, parts: 45 },

  exterior_wash: { kind: "fixed", price: 40, parts: 0 },
  interior_detail: { kind: "fixed", price: 90, parts: 0 },
  full_detail: { kind: "fixed", price: 160, parts: 0 },
  ceramic_coat: { kind: "fixed", price: 350, parts: 80 },

  jump_start: { kind: "fixed", price: 40, parts: 0 },
  flat_tire: { kind: "fixed", price: 65, parts: 0 },
  lockout: { kind: "fixed", price: 55, parts: 0 },
  fuel_delivery: { kind: "fixed", price: 25, parts: 0 },
  ev_charge: { kind: "fixed", price: 45, parts: 0 },

  glass_chip: { kind: "book", hours: 0.5, parts: 5 },
  glass_windshield: { kind: "glass", hours: 1.5, typical: [250, 600], calibrationHours: 2.5 },
  glass_side: { kind: "glass", hours: 1.2, typical: [180, 350] },
  glass_back: { kind: "glass", hours: 1.6, typical: [300, 700] },
  glass_adas: { kind: "book", hours: 2.5, parts: 0 },

  dot_annual: { kind: "fleet", hours: [1, 1.2, 1.5, 1], parts: [3, 3, 3, 3] },
  dot_brake: { kind: "fleet", hours: [0.8, 1, 1.2, 1], parts: [0, 0, 0, 0] },
  dot_dvir: { kind: "fleet", hours: [0.5, 0.5, 0.5, 0.5], parts: [0, 0, 0, 0] },
  fleet_wash: { kind: "fleet", wash: true, hours: [0.4, 0.7, 0.8, 0.8], parts: [3, 5, 5, 6] },
};

// Bigger vehicles take longer. Matched against the model name until real book times arrive.
export const VEHICLE_FACTORS = [["Ridgeline", 1.15], ["Silverado", 1.2], ["F-250", 1.2], ["F-150", 1.1], ["Transit", 1.1], ["Wrangler", 1.1]];

// What a typical local shop marks parts up, by part cost (shown to customers as "typical shop" for comparison).
export const SHOP_MARKUP = [[10, 2], [50, 1.1], [200, 0.75], [500, 0.52], [1500, 0.35], [Infinity, 0.25]];

// Fleet vehicle classes. Maintenance on bigger classes takes longer and needs bigger parts.
export const FLEET_CLASSES = ["van_pickup", "box_truck", "tractor", "trailer"];
export const FLEET_HOUR_FACTOR = [1, 1.5, 2, 1.5];
export const FLEET_PARTS_FACTOR = [1, 2.5, 4, 2.5];
