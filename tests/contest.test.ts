import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  contest,
  criteria,
  faq,
  finalistTeams,
  heroScenes,
  meritTeams,
  schedule,
  totalPoints,
  totalPrize,
  totalWinners,
} from '../src/data/contest';
import { koreanCount, koreanDate, manLabel, toMan, wonLabel } from '../src/lib/format';

describe('contest data', () => {
  it('adds up to the announced total prize and winner count', () => {
    expect(totalPrize).toBe(3_000_000);
    expect(totalWinners).toBe(6);
  });

  it('splits the winners into three finalists and three merit teams', () => {
    expect(finalistTeams).toBe(3);
    expect(meritTeams).toBe(3);
    expect(finalistTeams + meritTeams).toBe(totalWinners);
  });

  it('writes the derived dates and counts into the schedule and FAQ sentences', () => {
    const text = [...schedule.map((item) => item.detail), ...faq.map((item) => `${item.q} ${item.a}`)].join('\n');

    expect(text).toContain('23:59까지 이메일로 제출');
    expect(text).toContain('12월 7일에 이메일로');
    expect(text).toContain('12월 10일 컨버전스 데이');
    expect(text).toContain(`최대 ${contest.maxTeamSize}명`);
    expect(text).toContain(`PPT ${contest.maxSlides}장`);
    expect(text).toContain(`${contest.talkMinutes}분 이내`);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it('lists the schedule in chronological order starting with the deadline', () => {
    const times = schedule.map((item) => new Date(item.at).getTime());

    expect(schedule[0]?.at).toBe(contest.deadline);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times.every((time) => Number.isFinite(time))).toBe(true);
  });

  it('scores four criteria out of forty points', () => {
    expect(criteria).toHaveLength(4);
    expect(totalPoints).toBe(40);
  });

  it('has built road data for every hero scene, starting at the campus', () => {
    expect(heroScenes[0]?.id).toBe('gachon');
    expect(heroScenes.length).toBeGreaterThan(1);
    for (const scene of heroScenes) {
      expect(existsSync(new URL(`../public/data/roads-${scene.id}.json`, import.meta.url)), scene.id).toBe(true);
      expect(scene.label.length).toBeGreaterThan(0);
    }
  });

  it('uses a well-formed contact address', () => {
    expect(contest.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });
});

describe('koreanDate', () => {
  it('formats the deadline in Korean time with the right weekday', () => {
    const date = koreanDate(contest.deadline);

    expect(date).toMatchObject({ monthDay: '12.06', weekday: '일', time: '23:59', dotted: '2026.12.06', spoken: '12월 6일' });
  });

  it('spells out the time for screen readers', () => {
    expect(koreanDate('2026-12-06T23:59:59+09:00').spokenTime).toBe('오후 11시 59분');
    expect(koreanDate('2026-12-06T00:00:00+09:00').spokenTime).toBe('오전 12시');
    expect(koreanDate('2026-12-06T12:00:00+09:00').spokenTime).toBe('오후 12시');
    expect(koreanDate('2026-12-06T09:05:00+09:00').spokenTime).toBe('오전 9시 5분');
  });

  it('gives the weekdays of the result and final dates', () => {
    expect(koreanDate('2026-12-07T00:00:00+09:00').weekday).toBe('월');
    expect(koreanDate('2026-12-10T00:00:00+09:00').weekday).toBe('목');
  });

  it('converts a UTC instant to the Korean calendar date', () => {
    expect(koreanDate('2026-12-06T15:30:00Z').monthDay).toBe('12.07');
  });

  it('rejects an unparseable date', () => {
    expect(() => koreanDate('not-a-date')).toThrow('Invalid date');
  });
});

describe('koreanCount', () => {
  it('uses native Korean counting words up to ten and digits beyond', () => {
    expect(koreanCount(3)).toBe('세');
    expect(koreanCount(5)).toBe('다섯');
    expect(koreanCount(6)).toBe('여섯');
    expect(koreanCount(10)).toBe('열');
    expect(koreanCount(12)).toBe('12');
    expect(koreanCount(0)).toBe('0');
  });
});

describe('money labels', () => {
  it('converts won to ten-thousand units', () => {
    expect(toMan(1_100_000)).toBe(110);
    expect(manLabel(3_000_000)).toBe('300만원');
    expect(wonLabel(3_000_000)).toBe('3,000,000원');
  });

  it('rejects negative or non-finite amounts', () => {
    expect(() => toMan(-1)).toThrow('Invalid amount');
    expect(() => toMan(Number.NaN)).toThrow('Invalid amount');
  });
});
