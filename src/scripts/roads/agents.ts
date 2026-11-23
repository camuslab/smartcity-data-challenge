import { pointAt, type Edge, type Graph, type Point } from './graph';

/** 도로 위를 달리는 빛 한 점 */
export interface Agent {
  edge: number;
  forward: boolean;
  /** 간선 시작점으로부터의 거리 */
  s: number;
  warm: boolean;
  age: number;
  life: number;
  /** 지나온 위치(격자 좌표)를 담는 원형 버퍼 */
  readonly trail: Float32Array;
  trailCount: number;
  trailHead: number;
  sampleClock: number;
}

export type Random = () => number;

export const TRAIL_POINTS = 26;
const TRAIL_INTERVAL = 1 / 30;
/** 도로 등급별 속도(화면 px/s). 큰 도로일수록 빠르다. */
const SPEED_PX = [72, 58, 44, 30] as const;
/** 교차로에서 다음 도로를 고를 때의 가중치. 큰 도로로 몰리게 한다. */
const TURN_WEIGHT = [9, 7, 3, 1] as const;
const WARM_SHARE = 0.78;
const MIN_LIFE = 7;
const LIFE_SPREAD = 11;

export function createAgent(): Agent {
  return {
    edge: 0,
    forward: true,
    s: 0,
    warm: true,
    age: 0,
    life: MIN_LIFE,
    trail: new Float32Array(TRAIL_POINTS * 2),
    trailCount: 0,
    trailHead: 0,
    sampleClock: 0,
  };
}

/** 후보 간선 가운데 하나에 새로 올려놓는다. */
export function spawn(agent: Agent, graph: Graph, candidates: readonly number[], random: Random): void {
  const pool = candidates.length > 0 ? candidates : graph.edges.map((_, i) => i);
  const index = pool[Math.floor(random() * pool.length)] ?? 0;
  const edge = graph.edges[index]!;
  agent.edge = index;
  agent.forward = random() < 0.5;
  agent.s = random() * edge.length;
  agent.warm = random() < WARM_SHARE;
  agent.age = 0;
  agent.life = MIN_LIFE + random() * LIFE_SPREAD;
  agent.trailCount = 0;
  agent.trailHead = 0;
  agent.sampleClock = 0;
}

function pickNext(graph: Graph, node: number, from: number, random: Random): number {
  const options = graph.adjacency[node]!.filter((index) => index !== from);
  if (options.length === 0) return -1;
  const weights = options.map((index) => TURN_WEIGHT[graph.edges[index]!.cls] ?? 1);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = random() * total;
  for (let i = 0; i < options.length; i += 1) {
    roll -= weights[i]!;
    if (roll <= 0) return options[i]!;
  }
  return options[options.length - 1]!;
}

/** 교차로에 닿았을 때 다음 간선으로 옮긴다. 막다른 길이면 false. */
function turn(agent: Agent, graph: Graph, edge: Edge, overshoot: number, random: Random): boolean {
  const node = agent.forward ? edge.b : edge.a;
  const next = pickNext(graph, node, agent.edge, random);
  if (next === -1) return false;
  const nextEdge = graph.edges[next]!;
  agent.edge = next;
  agent.forward = nextEdge.a === node;
  agent.s = agent.forward ? overshoot : nextEdge.length - overshoot;
  return true;
}

function recordTrail(agent: Agent, graph: Graph, dt: number, scratch: Point): void {
  agent.sampleClock += dt;
  if (agent.sampleClock < TRAIL_INTERVAL) return;
  agent.sampleClock = 0;
  pointAt(graph.edges[agent.edge]!, agent.s, scratch);
  agent.trail[agent.trailHead * 2] = scratch.x;
  agent.trail[agent.trailHead * 2 + 1] = scratch.y;
  agent.trailHead = (agent.trailHead + 1) % TRAIL_POINTS;
  agent.trailCount = Math.min(agent.trailCount + 1, TRAIL_POINTS);
}

export type StepResult = 'moving' | 'turned' | 'ended';

/** dt초만큼 전진시킨다. 수명이 끝났거나 막다른 길이면 'ended'를 돌려준다. */
export function step(agent: Agent, graph: Graph, dt: number, scale: number, random: Random, scratch: Point): StepResult {
  agent.age += dt;
  if (agent.age >= agent.life) return 'ended';
  const edge = graph.edges[agent.edge]!;
  const distance = ((SPEED_PX[edge.cls] ?? SPEED_PX[3]) / scale) * dt;
  agent.s += agent.forward ? distance : -distance;
  let result: StepResult = 'moving';
  const overshoot = agent.forward ? agent.s - edge.length : -agent.s;
  if (overshoot >= 0) {
    if (!turn(agent, graph, edge, overshoot, random)) return 'ended';
    result = 'turned';
  }
  recordTrail(agent, graph, dt, scratch);
  return result;
}

/** 등장·퇴장 때 서서히 밝아지고 어두워지는 정도(0~1) */
export function visibility(agent: Agent): number {
  const fadeIn = Math.min(agent.age / 0.7, 1);
  const fadeOut = Math.min((agent.life - agent.age) / 1.1, 1);
  return Math.max(Math.min(fadeIn, fadeOut), 0);
}

/** 꼬리에서 i번째(0 = 가장 최근) 위치의 버퍼 인덱스. 없으면 -1. */
export function trailIndex(agent: Agent, i: number): number {
  if (i >= agent.trailCount) return -1;
  return (agent.trailHead - 1 - i + TRAIL_POINTS * 2) % TRAIL_POINTS;
}
