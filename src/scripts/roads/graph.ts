/**
 * 도로망 데이터(public/data/roads.json)를 검증하고 그리기 좋은 그래프로 바꾼다.
 * 좌표 단위는 격자 1칸 = 1m, y는 남쪽으로 증가한다.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Edge {
  readonly a: number;
  readonly b: number;
  /** 0 고속·간선, 1 주간선, 2 보조간선, 3 생활도로 */
  readonly cls: number;
  /** 양 끝점을 포함한 전체 꺾은선 좌표 [x0, y0, x1, y1, …] */
  readonly pts: Float32Array;
  /** 각 꼭짓점까지의 누적 길이 */
  readonly cum: Float32Array;
  readonly length: number;
}

export interface Graph {
  readonly width: number;
  readonly height: number;
  /** 지도의 기준점(격자 좌표). 화면의 초점이 되고 주변 도로가 밝게 빛난다. */
  readonly campus: Point;
  /** 지도 한가운데의 위도·경도. 파일에 범위 정보가 없으면 null. */
  readonly center: { readonly lat: number; readonly lon: number } | null;
  readonly edges: readonly Edge[];
  /** 노드 번호 → 연결된 간선 번호 목록 */
  readonly adjacency: readonly (readonly number[])[];
}

export const ROAD_CLASS_COUNT = 4;

type RawEdge = [number, number, number, number[]];

function isPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((v) => Number.isFinite(v));
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => Number.isFinite(v));
}

function isRawEdge(value: unknown, nodeCount: number): value is RawEdge {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [a, b, cls, mid] = value as unknown[];
  const inRange = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0 && (n as number) < nodeCount;
  const validClass = Number.isInteger(cls) && (cls as number) >= 0 && (cls as number) < ROAD_CLASS_COUNT;
  return inRange(a) && inRange(b) && validClass && isNumberArray(mid) && mid.length % 2 === 0;
}

function buildEdge(raw: RawEdge, nodes: readonly number[]): Edge {
  const [a, b, cls, mid] = raw;
  const pts = Float32Array.from([nodes[a * 2]!, nodes[a * 2 + 1]!, ...mid, nodes[b * 2]!, nodes[b * 2 + 1]!]);
  const cum = new Float32Array(pts.length / 2);
  for (let i = 1; i < cum.length; i += 1) {
    const dx = pts[i * 2]! - pts[i * 2 - 2]!;
    const dy = pts[i * 2 + 1]! - pts[i * 2 - 1]!;
    cum[i] = cum[i - 1]! + Math.hypot(dx, dy);
  }
  return { a, b, cls, pts, cum, length: cum[cum.length - 1] ?? 0 };
}

function buildAdjacency(edges: readonly Edge[], nodeCount: number): number[][] {
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  edges.forEach((edge, index) => {
    adjacency[edge.a]!.push(index);
    if (edge.b !== edge.a) adjacency[edge.b]!.push(index);
  });
  return adjacency;
}

/** 범위 [서, 남, 동, 북]의 한가운데 위도·경도 */
function centerOf(bbox: unknown): { lat: number; lon: number } | null {
  if (!isNumberArray(bbox) || bbox.length !== 4) return null;
  const [west, south, east, north] = bbox as [number, number, number, number];
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

/** 외부에서 받은 JSON을 검증해 그래프로 만든다. 형식이 틀리면 예외를 던진다. */
export function buildGraph(json: unknown): Graph {
  if (typeof json !== 'object' || json === null) {
    throw new Error('roads.json: 객체가 아닙니다.');
  }
  const { meta, nodes, edges } = json as {
    meta?: { grid?: unknown; campus?: unknown; bbox?: unknown };
    nodes?: unknown;
    edges?: unknown;
  };
  if (!meta || !isPair(meta.grid) || !isPair(meta.campus)) {
    throw new Error('roads.json: meta.grid 또는 meta.campus가 없습니다.');
  }
  if (!isNumberArray(nodes) || nodes.length % 2 !== 0 || !Array.isArray(edges)) {
    throw new Error('roads.json: nodes 또는 edges 형식이 올바르지 않습니다.');
  }
  const nodeCount = nodes.length / 2;
  const validEdges = edges.filter((edge): edge is RawEdge => isRawEdge(edge, nodeCount));
  if (validEdges.length === 0) {
    throw new Error('roads.json: 사용할 수 있는 도로가 없습니다.');
  }
  const built = validEdges.map((edge) => buildEdge(edge, nodes)).filter((edge) => edge.length > 0);
  return {
    width: meta.grid[0],
    height: meta.grid[1],
    campus: { x: meta.campus[0], y: meta.campus[1] },
    center: centerOf(meta.bbox),
    edges: built,
    adjacency: buildAdjacency(built, nodeCount),
  };
}

/**
 * 간선 위에서 시작점으로부터 거리 s인 지점을 out에 써 넣는다.
 * 매 프레임 수백 번 호출되므로 새 객체를 만들지 않는다.
 */
export function pointAt(edge: Edge, s: number, out: Point): Point {
  const { pts, cum } = edge;
  const last = cum.length - 1;
  const clamped = Math.min(Math.max(s, 0), edge.length);
  let i = 1;
  while (i < last && cum[i]! < clamped) i += 1;
  const span = cum[i]! - cum[i - 1]!;
  const t = span > 0 ? (clamped - cum[i - 1]!) / span : 0;
  const x0 = pts[i * 2 - 2]!;
  const y0 = pts[i * 2 - 1]!;
  out.x = x0 + (pts[i * 2]! - x0) * t;
  out.y = y0 + (pts[i * 2 + 1]! - y0) * t;
  return out;
}
