import { loadGraph } from './loader';
import { RoadRenderer, type RendererOptions } from './renderer';
import { cycleScenes, parseScenes, showSceneInfo } from './scenes';
import type { ViewOptions } from './view';

type Variant = 'hero' | 'closing';

const NARROW = 760;
const AGENT_AREA = 15_000;
/** 한 지역을 다 펼친 뒤 머무는 시간(초) */
const SCENE_HOLD_SECONDS = 3;

const VIEW_FOR: Record<Variant, (width: number, height: number) => ViewOptions> = {
  // 넓은 화면에서는 제목이 왼쪽을 차지하므로 기준점을 오른쪽으로 민다.
  // 좁은 화면에서는 글이 아래쪽에 놓이므로 기준점을 위쪽에 둔다.
  hero: (width) => (width < NARROW ? { focalX: 0.62, focalY: 0.13, zoom: 1.8 } : { focalX: 0.66, focalY: 0.44, zoom: 1.34 }),
  closing: (width) => (width < NARROW ? { focalX: 0.5, focalY: 0.5, zoom: 1.4 } : { focalX: 0.72, focalY: 0.5, zoom: 2.2 }),
};

const AGENTS_FOR: Record<Variant, (width: number, height: number) => number> = {
  hero: (width, height) => Math.round(Math.min(Math.max((width * height) / AGENT_AREA, 26), 96)),
  closing: (width, height) => Math.round(Math.min(Math.max((width * height) / (AGENT_AREA * 1.6), 14), 40)),
};

function trackPointer(host: HTMLElement, canvas: HTMLCanvasElement, renderer: RoadRenderer): void {
  host.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    renderer.setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  });
  host.addEventListener('pointerleave', () => renderer.setPointer(null));
}

/** 화면에 보일 때만 움직이게 한다. 상태를 다시 맞추는 함수를 돌려준다. */
function runWhileVisible(canvas: HTMLCanvasElement, renderer: RoadRenderer): () => void {
  let onScreen = false;
  const sync = (): void => {
    if (onScreen && !document.hidden) renderer.start();
    else renderer.stop();
  };
  new IntersectionObserver((entries) => {
    // 한 번에 여러 기록이 오면 마지막 것이 지금 상태다.
    onScreen = entries[entries.length - 1]?.isIntersecting ?? false;
    sync();
  }).observe(canvas);
  document.addEventListener('visibilitychange', sync);
  return sync;
}

/** 크기가 바뀌면 다음 프레임에 한 번만 다시 그린다. 창을 끄는 동안 매번 새로 만들지 않기 위해서다. */
function watchSize(canvas: HTMLCanvasElement, renderer: RoadRenderer, sync: () => void): void {
  let queued = false;
  const apply = (): void => {
    queued = false;
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    sync();
  };
  const request = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  };
  new ResizeObserver(request).observe(canvas);
  // 배율이 다른 모니터로 옮기면 크기는 그대로여도 해상도가 달라진다.
  window.addEventListener('resize', request);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function mount(canvas: HTMLCanvasElement): Promise<void> {
  const host = canvas.parentElement;
  const scenes = parseScenes(canvas.dataset.scenes);
  const first = scenes[0];
  if (!host || !first) return;
  const variant: Variant = canvas.dataset.variant === 'closing' ? 'closing' : 'hero';
  const reducedMotion = prefersReducedMotion();
  const cycling = scenes.length > 1 && !reducedMotion;
  const graph = await loadGraph(first.src);
  // 렌더러를 만든 뒤에야 전환 함수를 만들 수 있어서, 콜백은 나중에 채운다.
  const sceneEnd: { handler: (() => void) | null } = { handler: null };
  const options: RendererOptions = {
    viewFor: VIEW_FOR[variant],
    agentsFor: AGENTS_FOR[variant],
    intro: variant === 'hero',
    reducedMotion,
    ...(cycling ? { holdSeconds: SCENE_HOLD_SECONDS, onSceneEnd: () => sceneEnd.handler?.() } : {}),
  };
  const renderer = new RoadRenderer(canvas, graph, options);
  renderer.resize(canvas.clientWidth, canvas.clientHeight);
  if (variant === 'hero') trackPointer(host, canvas, renderer);
  watchSize(canvas, renderer, runWhileVisible(canvas, renderer));
  showSceneInfo(host, first, graph);
  canvas.classList.add('is-ready');
  if (cycling) sceneEnd.handler = cycleScenes(host, renderer, scenes);
}

/** 페이지의 모든 도로망 캔버스를 켠다. 실패하면 지도 없이 글만 보인다. */
export function initRoadNetworks(): void {
  document.querySelectorAll<HTMLCanvasElement>('canvas[data-road-network]').forEach((canvas) => {
    mount(canvas).catch((error: unknown) => {
      // 캔버스는 is-ready가 붙기 전까지 투명하므로 실패하면 그대로 보이지 않는다.
      console.warn('[road-network]', error instanceof Error ? error.message : error);
    });
  });
}
