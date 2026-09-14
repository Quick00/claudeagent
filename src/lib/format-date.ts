const TIMEZONE = 'Europe/Amsterdam';

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: TIMEZONE,
  });
}

export function formatDateTimeShort(date: string | Date): string {
  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: TIMEZONE,
  });
}

/** Recency buckets for grouping a list by when things last happened. */
export type RecencyBucket = 'today' | 'yesterday' | 'last7' | 'last30' | 'older';

/** Newest first. Iterate this to render groups in order. */
export const RECENCY_BUCKETS: readonly RecencyBucket[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'older',
] as const;

export const RECENCY_BUCKET_LABELS: Record<RecencyBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Previous 7 days',
  last30: 'Previous 30 days',
  older: 'Older',
};

// Intl formatters are expensive to construct and this runs once per row, so
// build it once. 'en-CA' is the shortest route to a YYYY-MM-DD string.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day `date` falls on in {@link TIMEZONE}, as a day count.
 * Comparing calendar days rather than elapsed milliseconds is what makes
 * "Yesterday" mean yesterday at 23:00 as well as yesterday at 00:30, and what
 * keeps the boundaries right across a DST change (where a day is 23 or 25
 * hours long).
 */
function zonedDayNumber(date: Date): number {
  const [year, month, day] = dayFormatter.format(date).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Which recency bucket `date` belongs to, relative to `now`.
 *
 * Boundaries are calendar days in {@link TIMEZONE}: anything on today's date
 * is `today`, the day before is `yesterday`, then 2-7 days back, 8-30 days
 * back, and everything else. A date in the future (clock skew between the
 * server that wrote it and the browser reading it) groups with today rather
 * than being pushed to the bottom of the list.
 */
export function recencyBucket(date: string | Date, now: Date = new Date()): RecencyBucket {
  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return 'older';

  const days = zonedDayNumber(now) - zonedDayNumber(then);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 7) return 'last7';
  if (days <= 30) return 'last30';
  return 'older';
}
