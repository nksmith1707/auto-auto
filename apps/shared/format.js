// Dates and times the way people read them, in the phone's own time zone.
const DAY = 86_400_000;

export const fmtDay = (ms) => {
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
export const fmtTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
export const fmtWindow = (start, end) => `${fmtDay(start)}, ${fmtTime(start)}–${fmtTime(end)}`;
export const fmtWhen = (ms) => `${fmtDay(ms)} at ${fmtTime(ms)}`;

export function fmtLeft(ms) {
  if (ms <= 0) return "now";
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ""}`;
}

// Arrival windows people can pick: the next 7 days, 2-hour windows from 8 AM to 4 PM, at least 2 hours out.
export function bookingDays(now = Date.now()) {
  const days = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
    const slots = [8, 10, 12, 14, 16].map((h) => new Date(d).setHours(h, 0, 0, 0)).filter((t) => t >= now + 2 * 3_600_000);
    if (slots.length) days.push({ day: d.getTime(), slots });
  }
  return days.slice(0, 7);
}

export const STATUS_LABEL = {
  requested: "Finding your partner",
  awaiting_approval: "Approve your partner",
  confirmed: "Confirmed",
  en_route: "On the way",
  arrived: "Arrived",
  in_progress: "Working",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "No partner found",
};
