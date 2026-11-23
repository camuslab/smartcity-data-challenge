import type { Point } from './graph';

/** 격자 좌표 → 화면 좌표 변환: screen = grid * scale + offset */
export interface View {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewOptions {
  /** 캠퍼스를 화면의 어느 지점(0~1)에 둘지 */
  readonly focalX: number;
  readonly focalY: number;
  /** 화면을 꽉 채우는 배율 대비 확대 정도 (1 이상) */
  readonly zoom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 지도가 화면을 빈틈없이 덮으면서 캠퍼스가 초점 위치에 오도록 변환을 계산한다.
 * 초점을 맞추면 지도 밖이 보이는 경우에는 지도 가장자리에 맞춰 당긴다.
 */
export function computeView(
  grid: { width: number; height: number },
  campus: Point,
  viewport: { width: number; height: number },
  options: ViewOptions,
): View {
  const cover = Math.max(viewport.width / grid.width, viewport.height / grid.height);
  const scale = cover * Math.max(options.zoom, 1);
  const wantedX = options.focalX * viewport.width - campus.x * scale;
  const wantedY = options.focalY * viewport.height - campus.y * scale;
  return {
    scale,
    offsetX: clamp(wantedX, viewport.width - grid.width * scale, 0),
    offsetY: clamp(wantedY, viewport.height - grid.height * scale, 0),
    width: viewport.width,
    height: viewport.height,
  };
}

export function toScreen(view: View, point: Point, out: Point): Point {
  out.x = point.x * view.scale + view.offsetX;
  out.y = point.y * view.scale + view.offsetY;
  return out;
}

/** 화면 안(여백 포함)에 있는지 */
export function isOnScreen(view: View, x: number, y: number, margin: number): boolean {
  return x >= -margin && y >= -margin && x <= view.width + margin && y <= view.height + margin;
}
