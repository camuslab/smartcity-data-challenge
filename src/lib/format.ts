const KST = 'Asia/Seoul';
const WON_PER_MAN = 10_000;

export interface KoreanDateParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  /** 일, 월, 화 … */
  readonly weekday: string;
  /** 23:59 */
  readonly time: string;
  /** 12.06 */
  readonly monthDay: string;
  /** 2026.12.06 */
  readonly dotted: string;
  /** 12월 6일 */
  readonly spoken: string;
  /** 오후 11시 59분. 화면낭독기가 "23:59"를 숫자로 읽지 않도록 따로 둔다. */
  readonly spokenTime: string;
}

const NOON = 12;

function spokenTimeOf(hour: number, minute: number): string {
  const half = hour < NOON ? '오전' : '오후';
  const hour12 = hour % NOON === 0 ? NOON : hour % NOON;
  return minute === 0 ? `${half} ${hour12}시` : `${half} ${hour12}시 ${minute}분`;
}

function partsOf(iso: string): Record<string, string> {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${iso}`);
  }
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
}

/** ISO 문자열을 한국 표준시 기준 표기 조각으로 바꾼다. */
export function koreanDate(iso: string): KoreanDateParts {
  const p = partsOf(iso);
  const year = p.year ?? '';
  const month = p.month ?? '';
  const day = p.day ?? '';
  return {
    year,
    month,
    day,
    weekday: p.weekday ?? '',
    time: `${p.hour}:${p.minute}`,
    monthDay: `${month}.${day}`,
    dotted: `${year}.${month}.${day}`,
    spoken: `${Number(month)}월 ${Number(day)}일`,
    spokenTime: spokenTimeOf(Number(p.hour), Number(p.minute)),
  };
}

const NATIVE_COUNT = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'] as const;

/** 개수를 세는 우리말 수사. 5 → "다섯". 10을 넘으면 숫자를 그대로 쓴다. */
export function koreanCount(n: number): string {
  return NATIVE_COUNT[n] || String(n);
}

/** 원 단위 금액을 만원 단위 숫자로 바꾼다. 1,100,000 → 110 */
export function toMan(won: number): number {
  if (!Number.isFinite(won) || won < 0) {
    throw new Error(`Invalid amount: ${won}`);
  }
  return Math.round(won / WON_PER_MAN);
}

/** 1,100,000 → "110만원" */
export function manLabel(won: number): string {
  return `${toMan(won).toLocaleString('ko-KR')}만원`;
}

/** 1100000 → "1,100,000원" */
export function wonLabel(won: number): string {
  return `${won.toLocaleString('ko-KR')}원`;
}

/** 배포 경로(base)를 붙인 내부 URL을 만든다. */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
