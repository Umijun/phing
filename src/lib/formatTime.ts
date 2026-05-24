const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sameCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** 24-hour clock, e.g. 14:32 */
export const fmtTime24 = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** Today → 24h time; yesterday → label; older → DD Mon */
export const formatNoteDate = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  if (sameCalendarDay(d, now)) return fmtTime24(iso);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameCalendarDay(d, yesterday)) return 'yesterday';

  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};
