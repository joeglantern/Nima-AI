/**
 * How long ago something happened, the way people say it.
 *
 * Short ("3h") beside a comment, long ("3 hours ago") under a post. Past a
 * month it is a date, because "14 weeks ago" makes people count.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function unit(value: number, word: string): string {
  return `${value} ${word}${value === 1 ? '' : 's'} ago`;
}

export function timeAgo(iso: string, style: 'short' | 'long' = 'short'): string {
  const then = new Date(iso);
  const gap = Math.max(0, Date.now() - then.getTime());
  const long = style === 'long';

  if (gap < MINUTE) return long ? 'Just now' : 'now';
  if (gap < HOUR) {
    const value = Math.floor(gap / MINUTE);
    return long ? unit(value, 'minute') : `${value}m`;
  }
  if (gap < DAY) {
    const value = Math.floor(gap / HOUR);
    return long ? unit(value, 'hour') : `${value}h`;
  }
  if (gap < WEEK) {
    const value = Math.floor(gap / DAY);
    return long ? unit(value, 'day') : `${value}d`;
  }
  if (gap < 5 * WEEK) {
    const value = Math.floor(gap / WEEK);
    return long ? unit(value, 'week') : `${value}w`;
  }

  return then.toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** 1,204 under ten thousand, 12.4k above, so a busy count still fits. */
export function compactCount(value: number): string {
  if (value < 10_000) return value.toLocaleString('en-KE');
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 100_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}
