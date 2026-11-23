const SOLID_AFTER = 0.82;
const STUCK_AFTER = 24;

/** 히어로를 벗어나면 머리말을 종이색으로 바꾼다. */
function watchHero(header: HTMLElement): void {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) {
    header.classList.add('is-solid');
    return;
  }
  const update = (): void => {
    const limit = hero.offsetHeight * SOLID_AFTER - header.offsetHeight;
    header.classList.toggle('is-stuck', window.scrollY > STUCK_AFTER);
    header.classList.toggle('is-solid', window.scrollY > limit);
  };
  let queued = false;
  window.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        update();
      });
    },
    { passive: true },
  );
  // 창 크기나 방향이 바뀌면 히어로 높이가 달라진다.
  window.addEventListener('resize', update);
  update();
}

/** 지금 보고 있는 구역의 메뉴 항목을 표시한다. */
function watchSections(header: HTMLElement): void {
  const links = Array.from(header.querySelectorAll<HTMLAnchorElement>('[data-nav-link]'));
  const byId = new Map(links.map((link) => [link.hash.slice(1), link]));
  // 메뉴에 없는 구역도 지켜봐야 그 구역에서 표시가 꺼진다.
  const sections = document.querySelectorAll<HTMLElement>('main > section[id]');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((link) => link.removeAttribute('aria-current'));
        byId.get(entry.target.id)?.setAttribute('aria-current', 'location');
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  sections.forEach((section) => observer.observe(section));
}

function setMenu(header: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
  header.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
}

function bindMenu(header: HTMLElement): void {
  const toggle = header.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const open = !header.classList.contains('is-open');
    setMenu(header, toggle, open);
    // 메뉴 항목이 단추보다 앞에 있으므로, 열면 첫 항목으로 옮겨 위에서부터 고르게 한다.
    if (open) header.querySelector<HTMLAnchorElement>('[data-nav-link]')?.focus();
  });
  header.querySelectorAll<HTMLAnchorElement>('[data-nav-link]').forEach((link) => {
    link.addEventListener('click', () => setMenu(header, toggle, false));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !header.classList.contains('is-open')) return;
    setMenu(header, toggle, false);
    toggle.focus();
  });
}

export function initHeader(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  watchHero(header);
  watchSections(header);
  bindMenu(header);
}
