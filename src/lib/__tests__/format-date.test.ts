import { describe, expect, test } from '@jest/globals';
import {
  RECENCY_BUCKETS,
  RECENCY_BUCKET_LABELS,
  recencyBucket,
  type RecencyBucket,
} from '../format-date';

/**
 * The app pins everything to Europe/Amsterdam, so the fixtures are written as
 * UTC instants with the local wall-clock time noted beside them. In summer
 * Amsterdam is UTC+2, in winter UTC+1.
 */
describe('recencyBucket', () => {
  // 2026-06-15 14:00 UTC = 16:00 Amsterdam (CEST, UTC+2)
  const now = new Date('2026-06-15T14:00:00Z');

  const cases: [string, string, RecencyBucket][] = [
    ['the same moment', '2026-06-15T14:00:00Z', 'today'],
    ['earlier today', '2026-06-15T05:00:00Z', 'today'],
    ['just after local midnight today', '2026-06-14T22:30:00Z', 'today'],
    ['late yesterday evening', '2026-06-14T20:00:00Z', 'yesterday'],
    ['yesterday morning', '2026-06-14T06:00:00Z', 'yesterday'],
    ['two days ago', '2026-06-13T12:00:00Z', 'last7'],
    ['seven days ago', '2026-06-08T12:00:00Z', 'last7'],
    ['eight days ago', '2026-06-07T12:00:00Z', 'last30'],
    ['thirty days ago', '2026-05-16T12:00:00Z', 'last30'],
    ['thirty-one days ago', '2026-05-15T12:00:00Z', 'older'],
    ['last year', '2025-06-15T12:00:00Z', 'older'],
  ];

  test.each(cases)('puts %s in %s', (_label, iso, expected) => {
    expect(recencyBucket(iso, now)).toBe(expected);
  });

  test('buckets on the calendar day, not on elapsed hours', () => {
    // 00:30 Amsterdam today, only 90 minutes before "now" would be if we
    // measured in hours from midnight — but 15.5 hours before `now`. An
    // elapsed-time implementation reading ">24h = yesterday" gets this right
    // by accident; one reading "<24h = today" gets the next case wrong.
    expect(recencyBucket('2026-06-14T22:30:00Z', now)).toBe('today');
    // 23:00 Amsterdam yesterday is 17 hours before `now` — under 24 hours,
    // but a different calendar day, so it must not read as "Today".
    expect(recencyBucket('2026-06-14T21:00:00Z', now)).toBe('yesterday');
  });

  test('handles the month boundary', () => {
    const firstOfMonth = new Date('2026-07-01T09:00:00Z'); // 11:00 Amsterdam
    expect(recencyBucket('2026-06-30T20:00:00Z', firstOfMonth)).toBe('yesterday');
    expect(recencyBucket('2026-07-01T00:30:00Z', firstOfMonth)).toBe('today');
  });

  test('handles the year boundary', () => {
    const newYearsDay = new Date('2027-01-01T09:00:00Z'); // 10:00 Amsterdam (CET)
    expect(recencyBucket('2026-12-31T15:00:00Z', newYearsDay)).toBe('yesterday');
    expect(recencyBucket('2026-12-30T15:00:00Z', newYearsDay)).toBe('last7');
  });

  test('survives the spring DST change, where a local day is 23 hours long', () => {
    // Amsterdam goes UTC+1 -> UTC+2 at 02:00 local on 2026-03-29.
    const afterChange = new Date('2026-03-29T10:00:00Z'); // 12:00 CEST
    expect(recencyBucket('2026-03-29T00:30:00Z', afterChange)).toBe('today'); // 01:30 CET, 29th
    // 23:30Z on the 28th is already 00:30 local on the 29th — still "today".
    expect(recencyBucket('2026-03-28T23:30:00Z', afterChange)).toBe('today');
    expect(recencyBucket('2026-03-28T20:00:00Z', afterChange)).toBe('yesterday'); // 21:00 CET, 28th
  });

  test('survives the autumn DST change, where a local day is 25 hours long', () => {
    // Amsterdam goes UTC+2 -> UTC+1 at 03:00 local on 2026-10-25.
    const afterChange = new Date('2026-10-25T12:00:00Z'); // 13:00 CET
    expect(recencyBucket('2026-10-25T00:30:00Z', afterChange)).toBe('today'); // 02:30 CEST
    expect(recencyBucket('2026-10-24T21:30:00Z', afterChange)).toBe('yesterday'); // 23:30 CEST
  });

  test('groups a future timestamp with today rather than burying it', () => {
    // Clock skew between the server that wrote updatedAt and this browser.
    expect(recencyBucket('2026-06-16T09:00:00Z', now)).toBe('today');
  });

  test('falls back to "older" for an unparseable date', () => {
    expect(recencyBucket('not a date', now)).toBe('older');
  });

  test('accepts a Date as well as an ISO string', () => {
    expect(recencyBucket(new Date('2026-06-14T06:00:00Z'), now)).toBe('yesterday');
  });

  test('every bucket is ordered newest first and has a label', () => {
    expect([...RECENCY_BUCKETS]).toEqual(['today', 'yesterday', 'last7', 'last30', 'older']);
    for (const bucket of RECENCY_BUCKETS) {
      expect(RECENCY_BUCKET_LABELS[bucket]).toBeTruthy();
    }
  });
});
