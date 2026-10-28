// A partner's rating as customers see it: the average of their last 100 ratings (hidden reviews still count;
// staff hide only the words of abusive reviews).
export const RATING_WINDOW = 100;

export async function ratingSummary(q, partnerId) {
  const rows = await q.all(`SELECT stars FROM ratings WHERE partner_id = $1 ORDER BY created_at DESC LIMIT ${RATING_WINDOW}`, [partnerId]);
  if (!rows.length) return { average: null, count: 0 };
  const avg = rows.reduce((a, r) => a + Number(r.stars), 0) / rows.length;
  return { average: Math.round(avg * 100) / 100, count: Number((await q.get(`SELECT COUNT(*) AS n FROM ratings WHERE partner_id = $1`, [partnerId])).n) };
}

// "Jordan R." — how customers and partners appear to each other.
export const shortName = (u) => (u ? `${u.first_name} ${u.last_name ? `${u.last_name[0]}.` : ""}`.trim() : null);
