const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;

export interface Countdown {
  readonly closed: boolean;
  /** 한국 날짜 기준으로 남은 일수. 마감 당일은 0. */
  readonly calendarDays: number;
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** "D-12", "D-DAY", "마감" */
  readonly label: string;
}

function kstDayIndex(ms: number): number {
  return Math.floor((ms + KST_OFFSET) / DAY);
}

function labelFor(closed: boolean, calendarDays: number): string {
  if (closed) return '마감';
  return calendarDays === 0 ? 'D-DAY' : `D-${calendarDays}`;
}

/** 현재 시각과 마감 시각(ms)으로 남은 시간을 계산한다. */
export function getCountdown(nowMs: number, deadlineMs: number): Countdown {
  const remaining = deadlineMs - nowMs;
  const closed = remaining <= 0;
  const left = Math.max(remaining, 0);
  const calendarDays = closed ? 0 : kstDayIndex(deadlineMs) - kstDayIndex(nowMs);
  return {
    closed,
    calendarDays,
    days: Math.floor(left / DAY),
    hours: Math.floor((left % DAY) / HOUR),
    minutes: Math.floor((left % HOUR) / MINUTE),
    seconds: Math.floor((left % MINUTE) / SECOND),
    label: labelFor(closed, calendarDays),
  };
}

export type Phase = 'done' | 'next' | 'upcoming';

/** 일정 항목들 가운데 지난 것, 다음 것, 그 이후 것을 구분한다. */
export function phasesFor(nowMs: number, eventTimes: readonly number[]): Phase[] {
  const nextIndex = eventTimes.findIndex((t) => t > nowMs);
  return eventTimes.map((_, i) => {
    if (nextIndex === -1 || i < nextIndex) return 'done';
    return i === nextIndex ? 'next' : 'upcoming';
  });
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
