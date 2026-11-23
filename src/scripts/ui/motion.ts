const COUNT_MS = 1_400;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
}

function countUp(el: HTMLElement): void {
  const target = Number(el.dataset.countTo);
  if (!Number.isFinite(target) || prefersReducedMotion()) return;
  const started = performance.now();
  const frame = (now: number): void => {
    const t = Math.min((now - started) / COUNT_MS, 1);
    el.textContent = Math.round(target * easeOutExpo(t)).toLocaleString('ko-KR');
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** 화면에 들어온 요소에 is-in을 붙이고, 숫자는 한 번만 올려 센다. */
export function initReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal], [data-count-to]');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.classList.add('is-in');
        if (el.dataset.countTo) countUp(el);
        observer.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
  );
  targets.forEach((el) => observer.observe(el));
  // 키보드로 아직 등장하지 않은 구역 안의 링크에 닿으면, 보이지 않는 채로 포커스만 가지 않게 바로 보여 준다.
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element) event.target.closest('[data-reveal]')?.classList.add('is-in');
  });
}
