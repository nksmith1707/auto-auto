// Services that need proof on file (RULES.md: brake work, glass, DOT inspections, washing), and which approved
// document each one needs. Partners can switch these services on any time, but they only get those jobs once
// staff have approved the proof, during the application or after it.
export const BRAKES = ["brakes", "dot_brake"];
export const GLASS = ["glass_chip", "glass_windshield", "glass_side", "glass_back", "glass_adas"];
export const DOT = ["dot_annual", "dot_brake", "dot_dvir"];
export const WASH = ["exterior_wash", "full_detail", "fleet_wash"];

export const PROOF_FOR = {};
for (const [ids, kind] of [[BRAKES, "ase"], [GLASS, "glass_cert"], [DOT, "dot_cert"], [WASH, "wash"]]) {
  for (const id of ids) (PROOF_FOR[id] = PROOF_FOR[id] || []).push(kind);
}

// Document kinds staff have approved for this partner (current uploads only).
export async function approvedProof(q, userId) {
  const rows = await q.all(`SELECT DISTINCT kind FROM partner_documents WHERE user_id = $1 AND status = 'approved' AND replaced_at IS NULL`, [userId]);
  return new Set(rows.map((r) => r.kind));
}

// The services in the list that still wait for approved proof.
export function missingProof(kinds, serviceIds) {
  return serviceIds.filter((id) => (PROOF_FOR[id] || []).some((k) => !kinds.has(k)));
}
