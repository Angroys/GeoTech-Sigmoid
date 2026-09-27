const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export const formatDate = (date: Date) => DATE.format(date);

export const formatClock = (date: Date) => CLOCK.format(date);

export const formatDuration = (from: Date, to: Date) => {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};
