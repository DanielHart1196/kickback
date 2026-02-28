type VenueRateSource = {
  kickback_guest?: number | null;
  kickback_referrer?: number | null;
  happy_hour_start_time?: string | null;
  happy_hour_end_time?: string | null;
  happy_hour_days?: string[] | null;
  happy_hour_start_time_2?: string | null;
  happy_hour_end_time_2?: string | null;
  happy_hour_days_2?: string[] | null;
  happy_hour_start_time_3?: string | null;
  happy_hour_end_time_3?: string | null;
  happy_hour_days_3?: string[] | null;
};

const HAPPY_HOUR_RATE = 10;
const TIME_ZONE = 'Australia/Sydney';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function parseHourMinute(value: string | null | undefined): number | null {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeDays(days: string[] | null | undefined): Set<string> {
  const normalized = new Set<string>();
  for (const day of days ?? []) {
    const key = String(day ?? '').trim().slice(0, 3);
    const title = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
    if (WEEKDAYS.includes(title as (typeof WEEKDAYS)[number])) {
      normalized.add(title);
    }
  }
  return normalized;
}

function getLocalDayAndMinutes(inputTime: string | Date): { day: string; minutes: number } | null {
  const date = inputTime instanceof Date ? inputTime : new Date(inputTime);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = String(lookup.weekday ?? '').slice(0, 3);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  if (!WEEKDAYS.includes(day as (typeof WEEKDAYS)[number])) return null;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { day, minutes: hour * 60 + minute };
}

function getHappyHourWindows(venue: VenueRateSource): Array<{
  startMinutes: number;
  endMinutes: number;
  days: Set<string>;
}> {
  const windows = [
    {
      start: venue.happy_hour_start_time,
      end: venue.happy_hour_end_time,
      days: venue.happy_hour_days
    },
    {
      start: venue.happy_hour_start_time_2,
      end: venue.happy_hour_end_time_2,
      days: venue.happy_hour_days_2
    },
    {
      start: venue.happy_hour_start_time_3,
      end: venue.happy_hour_end_time_3,
      days: venue.happy_hour_days_3
    }
  ];
  const result: Array<{ startMinutes: number; endMinutes: number; days: Set<string> }> = [];
  for (const window of windows) {
    const startMinutes = parseHourMinute(window.start);
    const endMinutes = parseHourMinute(window.end);
    const days = normalizeDays(window.days);
    if (startMinutes === null || endMinutes === null || days.size === 0 || startMinutes === endMinutes) {
      continue;
    }
    result.push({ startMinutes, endMinutes, days });
  }
  return result;
}

export function isHappyHourActive(venue: VenueRateSource, inputTime: string | Date): boolean {
  const windows = getHappyHourWindows(venue);
  if (windows.length === 0) return false;
  const local = getLocalDayAndMinutes(inputTime);
  if (!local) return false;

  for (const window of windows) {
    if (!window.days.has(local.day)) continue;
    if (window.startMinutes < window.endMinutes) {
      if (local.minutes >= window.startMinutes && local.minutes < window.endMinutes) return true;
    } else {
      if (local.minutes >= window.startMinutes || local.minutes < window.endMinutes) return true;
    }
  }
  return false;
}

export function getVenueRatesForTime(
  venue: VenueRateSource,
  inputTime: string | Date,
  fallback = 5
): { guestRate: number; referrerRate: number } {
  const guestRate = Number(venue.kickback_guest ?? fallback);
  const referrerRate = Number(venue.kickback_referrer ?? fallback);
  if (!isHappyHourActive(venue, inputTime)) {
    return { guestRate, referrerRate };
  }
  return { guestRate: HAPPY_HOUR_RATE, referrerRate: HAPPY_HOUR_RATE };
}
