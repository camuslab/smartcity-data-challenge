import { describe, expect, it } from 'vitest';
import { getCountdown, pad2, phasesFor } from '../src/lib/countdown';

const DEADLINE = new Date('2026-12-06T23:59:59+09:00').getTime();
const at = (iso: string): number => new Date(iso).getTime();

describe('getCountdown', () => {
  it('counts calendar days in Korean time, not 24-hour blocks', () => {
    // Arrange: 11월 24일 새벽 0시 49분 (한국 시각)
    const now = at('2026-11-24T00:49:00+09:00');

    // Act
    const result = getCountdown(now, DEADLINE);

    // Assert
    expect(result.label).toBe('D-12');
    expect(result.calendarDays).toBe(12);
    expect(result.days).toBe(12);
    expect(result.hours).toBe(23);
    expect(result.minutes).toBe(10);
    expect(result.closed).toBe(false);
  });

  it('keeps the same D-day label late in the evening', () => {
    const result = getCountdown(at('2026-11-24T23:30:00+09:00'), DEADLINE);

    expect(result.label).toBe('D-12');
    expect(result.days).toBe(12);
  });

  it('shows D-DAY throughout the deadline date', () => {
    const morning = getCountdown(at('2026-12-06T00:00:01+09:00'), DEADLINE);
    const lastMinute = getCountdown(at('2026-12-06T23:59:00+09:00'), DEADLINE);

    expect(morning.label).toBe('D-DAY');
    expect(lastMinute.label).toBe('D-DAY');
    expect(lastMinute.seconds).toBe(59);
  });

  it('uses the Korean date even when the viewer clock is in UTC', () => {
    // 한국 12월 6일 08:00은 UTC로 12월 5일 23:00이다.
    const result = getCountdown(at('2026-12-05T23:00:00Z'), DEADLINE);

    expect(result.label).toBe('D-DAY');
  });

  it('reports closed with zeroed fields once the deadline passes', () => {
    const result = getCountdown(DEADLINE + 1, DEADLINE);

    expect(result).toMatchObject({ closed: true, label: '마감', days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it('treats the exact deadline instant as closed', () => {
    expect(getCountdown(DEADLINE, DEADLINE).closed).toBe(true);
  });
});

describe('phasesFor', () => {
  const events = [at('2026-12-06T23:59:59+09:00'), at('2026-12-07T00:00:00+09:00'), at('2026-12-10T00:00:00+09:00')];

  it('marks the first event as next before anything has happened', () => {
    expect(phasesFor(at('2026-11-24T10:00:00+09:00'), events)).toEqual(['next', 'upcoming', 'upcoming']);
  });

  it('moves to the following event once one has passed', () => {
    expect(phasesFor(at('2026-12-08T10:00:00+09:00'), events)).toEqual(['done', 'done', 'next']);
  });

  it('marks everything done after the last event', () => {
    expect(phasesFor(at('2026-12-11T10:00:00+09:00'), events)).toEqual(['done', 'done', 'done']);
  });

  it('keeps a date-only event as next for the whole of its day when given the end of that day', () => {
    // 일정 화면은 날짜만 있는 일정의 경계를 그날 23:59:59.999로 넘긴다.
    const finalDayEnd = at('2026-12-10T00:00:00+09:00') + 24 * 60 * 60 * 1000 - 1;
    const ends = [events[0]!, events[1]! + 24 * 60 * 60 * 1000 - 1, finalDayEnd];

    expect(phasesFor(at('2026-12-10T14:00:00+09:00'), ends)).toEqual(['done', 'done', 'next']);
    expect(getCountdown(at('2026-12-10T14:00:00+09:00'), finalDayEnd).label).toBe('D-DAY');
    expect(getCountdown(at('2026-12-09T14:00:00+09:00'), finalDayEnd).label).toBe('D-1');
    expect(phasesFor(at('2026-12-11T00:00:00+09:00'), ends)).toEqual(['done', 'done', 'done']);
  });

  it('returns an empty list for no events', () => {
    expect(phasesFor(0, [])).toEqual([]);
  });
});

describe('pad2', () => {
  it('pads single digits and leaves two digits alone', () => {
    expect(pad2(3)).toBe('03');
    expect(pad2(12)).toBe('12');
  });
});
