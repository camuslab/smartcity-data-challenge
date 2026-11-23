import { getCountdown, pad2, phasesFor, type Countdown } from '../../lib/countdown';

const TICK_MS = 1_000;

function clockText(c: Countdown): string {
  return `${c.days}일 ${pad2(c.hours)}:${pad2(c.minutes)}:${pad2(c.seconds)} 남음`;
}

/** 서버에서 그려 둔 원래 글(마감 일시)을 기억해 두었다가 마감 뒤에 되돌려 쓴다. */
function rememberStaticText(el: HTMLElement): string {
  el.dataset.staticText ??= el.textContent ?? '';
  return el.dataset.staticText;
}

/** 값이 바뀔 때만 써서, 화면낭독기가 읽던 글이 매초 갈아 끼워지지 않게 한다. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** 화면낭독기용 마감 안내 문장을 마감 뒤의 문장으로 바꾼다. */
function announceClosed(): void {
  document.querySelectorAll<HTMLElement>('[data-deadline-text]').forEach((el) => {
    setText(el, el.dataset.closedText ?? '');
  });
}

function renderCountdown(c: Countdown): void {
  document.querySelectorAll<HTMLElement>('[data-dday]').forEach((el) => setText(el, c.label));
  if (c.closed) announceClosed();
  document.querySelectorAll<HTMLElement>('[data-clock]').forEach((el) => {
    const staticText = rememberStaticText(el);
    el.textContent = c.closed ? staticText : clockText(c);
  });
  document.documentElement.classList.toggle('is-closed', c.closed);
}

/** 일정 항목에 지남·다음·예정 상태를 붙이고, 다음 일정까지 남은 날을 적는다. */
function renderSchedule(now: number): void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-event-end]'));
  if (items.length === 0) return;
  const ends = items.map((el) => Number(el.dataset.eventEnd));
  const phases = phasesFor(now, ends);
  items.forEach((el, i) => {
    const phase = phases[i]!;
    if (el.dataset.phase !== phase) el.dataset.phase = phase;
    const chip = el.querySelector<HTMLElement>('[data-event-chip]');
    if (!chip) return;
    if (phase === 'done') setText(chip, '완료');
    else if (phase === 'next') setText(chip, getCountdown(now, ends[i]!).label);
    else setText(chip, '');
  });
}

/** 마감까지 남은 시간과 일정 상태를 1초마다 갱신한다. */
export function initClock(): void {
  const source = document.querySelector<HTMLElement>('[data-deadline]');
  const deadline = Number(source?.dataset.deadline);
  if (!source || !Number.isFinite(deadline)) return;
  const update = (): void => {
    const now = Date.now();
    renderCountdown(getCountdown(now, deadline));
    renderSchedule(now);
  };
  update();
  window.setInterval(update, TICK_MS);
}
