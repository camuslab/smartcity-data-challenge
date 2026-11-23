import type { Graph } from './graph';
import { loadGraph } from './loader';
import type { RoadRenderer } from './renderer';

/** 히어로 지도가 차례로 보여 주는 지역 하나 */
export interface Scene {
  readonly src: string;
  readonly label: string;
  readonly area: string;
}

const FADE_MS = 400;
const COORD_DECIMALS = 4;

function isScene(value: unknown): value is Scene {
  if (typeof value !== 'object' || value === null) return false;
  const { src, label, area } = value as Record<string, unknown>;
  return typeof src === 'string' && src.length > 0 && typeof label === 'string' && typeof area === 'string';
}

/** 캔버스의 data-scenes 값을 읽는다. 형식이 틀린 항목은 버린다. */
export function parseScenes(raw: string | undefined): Scene[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isScene) : [];
  } catch {
    console.warn('[road-network] data-scenes를 읽지 못했습니다.');
    return [];
  }
}

/** 아래쪽 좌표와 지역 이름을 지금 지역의 것으로 바꾼다. */
export function showSceneInfo(host: HTMLElement, scene: Scene, graph: Graph): void {
  const latlon = host.querySelector<HTMLElement>('[data-road-latlon]');
  if (latlon && graph.center) {
    latlon.textContent = `${graph.center.lat.toFixed(COORD_DECIMALS)}°N ${graph.center.lon.toFixed(COORD_DECIMALS)}°E`;
  }
  const area = host.querySelector<HTMLElement>('[data-road-area]');
  if (area) area.textContent = ` · ${scene.area}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 지역을 차례로 바꿔 보여 주는 함수를 만든다. 렌더러가 "이 지역을 충분히 보여 줬다"고 알릴 때마다 부른다.
 * 받아 오지 못한 지역은 건너뛰고, 다른 지역을 하나도 못 받으면 지금 지역에 머문다.
 */
export function cycleScenes(host: HTMLElement, renderer: RoadRenderer, scenes: readonly Scene[]): () => void {
  let index = 0;
  let busy = false;
  // 미리 받아 둔다. 실패는 실제로 바꿀 때 다시 확인하므로 여기서는 넘긴다.
  scenes.slice(1).forEach((scene) => void loadGraph(scene.src).catch(() => undefined));

  const advance = async (): Promise<void> => {
    for (let skip = 1; skip < scenes.length; skip += 1) {
      const next = (index + skip) % scenes.length;
      const scene = scenes[next]!;
      const graph = await loadGraph(scene.src).catch((error: unknown) => {
        console.warn('[road-network]', error instanceof Error ? error.message : error);
        return null;
      });
      if (!graph) continue;
      host.classList.add('is-switching');
      await wait(FADE_MS);
      renderer.setGraph(graph);
      showSceneInfo(host, scene, graph);
      index = next;
      host.classList.remove('is-switching');
      return;
    }
  };

  return () => {
    if (busy) return;
    busy = true;
    void advance().finally(() => {
      busy = false;
    });
  };
}
