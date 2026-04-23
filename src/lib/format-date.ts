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
