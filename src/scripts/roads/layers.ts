import { ROAD_CLASS_COUNT, type Graph } from './graph';
import type { View } from './view';

/** 움직이지 않는 도로 그림을 미리 그려 두는 레이어 */
export interface Layers {
  /** 어두운 밤 지도 위의 도로 */
  readonly base: HTMLCanvasElement;
  /** 같은 도로를 앰버색으로 밝게 그린 것. 포인터와 캠퍼스 주변에만 비춰 쓴다. */
  readonly hot: HTMLCanvasElement;
}

interface RoadStyle {
  readonly width: number;
  readonly alpha: number;
}

const ROAD_RGB = '155 180 228';
const AMBER_RGB = '255 178 36';
const BASE_STYLE: readonly RoadStyle[] = [
  { width: 2.2, alpha: 0.72 },
  { width: 1.6, alpha: 0.6 },
  { width: 1.1, alpha: 0.44 },
  { width: 0.8, alpha: 0.3 },
];
const HOT_STYLE: readonly RoadStyle[] = [
  { width: 2.3, alpha: 0.95 },
  { width: 1.8, alpha: 0.9 },
  { width: 1.3, alpha: 0.78 },
  { width: 0.9, alpha: 0.6 },
];

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D 캔버스를 사용할 수 없습니다.');
  return ctx;
}

function traceClass(ctx: CanvasRenderingContext2D, graph: Graph, view: View, cls: number): void {
  const { scale, offsetX, offsetY } = view;
  ctx.beginPath();
  for (const edge of graph.edges) {
    if (edge.cls !== cls) continue;
    const { pts } = edge;
    ctx.moveTo(pts[0]! * scale + offsetX, pts[1]! * scale + offsetY);
    for (let i = 2; i < pts.length; i += 2) {
      ctx.lineTo(pts[i]! * scale + offsetX, pts[i + 1]! * scale + offsetY);
    }
  }
}

function paint(
  canvas: HTMLCanvasElement,
  graph: Graph,
  view: View,
  dpr: number,
  rgb: string,
  styles: readonly RoadStyle[],
): void {
  const ctx = context2d(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 작은 도로부터 그려 큰 도로가 위에 오게 한다.
  for (let cls = ROAD_CLASS_COUNT - 1; cls >= 0; cls -= 1) {
    const style = styles[cls]!;
    traceClass(ctx, graph, view, cls);
    ctx.strokeStyle = `rgb(${rgb} / ${style.alpha})`;
    ctx.lineWidth = style.width;
    ctx.stroke();
  }
}

export function buildLayers(graph: Graph, view: View, dpr: number): Layers {
  const width = Math.max(1, Math.round(view.width * dpr));
  const height = Math.max(1, Math.round(view.height * dpr));
  const base = createCanvas(width, height);
  const hot = createCanvas(width, height);
  paint(base, graph, view, dpr, ROAD_RGB, BASE_STYLE);
  paint(hot, graph, view, dpr, AMBER_RGB, HOT_STYLE);
  return { base, hot };
}

/** 빛 점 머리에 찍는 작은 발광 스프라이트 */
export function buildSprite(rgb: string, size: number): HTMLCanvasElement {
  const canvas = createCanvas(size, size);
  const ctx = context2d(canvas);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgb(${rgb} / 1)`);
  gradient.addColorStop(0.22, `rgb(${rgb} / 0.85)`);
  gradient.addColorStop(0.5, `rgb(${rgb} / 0.22)`);
  gradient.addColorStop(1, `rgb(${rgb} / 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export const WARM_RGB = '255 190 70';
export const COOL_RGB = '214 228 255';
