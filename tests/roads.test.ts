import { describe, expect, it } from 'vitest';
import { createAgent, spawn, step, trailIndex, visibility } from '../src/scripts/roads/agents';
import { buildGraph, pointAt } from '../src/scripts/roads/graph';
import { parseScenes } from '../src/scripts/roads/scenes';
import { computeView, isOnScreen, toScreen } from '../src/scripts/roads/view';

/** ㄱ자 도로 하나와 갈림길 하나: 0 ─ 1 ─ 2, 1 ─ 3 */
const sample = {
  meta: { grid: [100, 100], campus: [50, 50] },
  nodes: [0, 0, 60, 0, 100, 0, 60, 80],
  edges: [
    [0, 1, 1, [30, 0]],
    [1, 2, 0, []],
    [1, 3, 3, []],
  ],
};

const fixed = (value: number) => (): number => value;

describe('buildGraph', () => {
  it('builds polylines, lengths and adjacency from the raw file', () => {
    const graph = buildGraph(sample);

    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0]?.length).toBe(60);
    expect(Array.from(graph.edges[0]?.pts ?? [])).toEqual([0, 0, 30, 0, 60, 0]);
    expect(graph.adjacency[1]).toEqual([0, 1, 2]);
    expect(graph.campus).toEqual({ x: 50, y: 50 });
  });

  it('reads the map centre from the bounding box, or null without one', () => {
    const withBox = buildGraph({ ...sample, meta: { ...sample.meta, bbox: [127.0, 37.4, 127.2, 37.5] } });

    expect(withBox.center?.lat).toBeCloseTo(37.45, 6);
    expect(withBox.center?.lon).toBeCloseTo(127.1, 6);
    expect(buildGraph(sample).center).toBeNull();
  });

  it('drops edges that point at missing nodes or have an unknown class', () => {
    const graph = buildGraph({ ...sample, edges: [...sample.edges, [0, 9, 1, []], [0, 1, 7, []], [2, 2, 3, []]] });

    expect(graph.edges).toHaveLength(3);
  });

  it('rejects files without usable roads or metadata', () => {
    expect(() => buildGraph(null)).toThrow('객체가 아닙니다');
    expect(() => buildGraph({ nodes: [], edges: [] })).toThrow('meta');
    expect(() => buildGraph({ ...sample, edges: [] })).toThrow('도로가 없습니다');
    expect(() => buildGraph({ ...sample, nodes: [0, 0, 1] })).toThrow('형식');
  });
});

describe('parseScenes', () => {
  it('keeps well-formed scenes and drops the rest', () => {
    const raw = JSON.stringify([
      { src: '/data/roads-gachon.json', label: '가천대학교', area: '경기도 성남시 수정구' },
      { src: '', label: '빈 주소', area: '' },
      { label: '주소 없음', area: '' },
      'not-an-object',
    ]);

    expect(parseScenes(raw)).toEqual([{ src: '/data/roads-gachon.json', label: '가천대학교', area: '경기도 성남시 수정구' }]);
  });

  it('returns an empty list for missing, malformed or non-list input', () => {
    expect(parseScenes(undefined)).toEqual([]);
    expect(parseScenes('{"src":"x"}')).toEqual([]);
    expect(parseScenes('not json')).toEqual([]);
  });
});

describe('pointAt', () => {
  const edge = buildGraph(sample).edges[2]!;

  it('interpolates along the edge and clamps past either end', () => {
    expect(pointAt(edge, 40, { x: 0, y: 0 })).toEqual({ x: 60, y: 40 });
    expect(pointAt(edge, -5, { x: 0, y: 0 })).toEqual({ x: 60, y: 0 });
    expect(pointAt(edge, 999, { x: 0, y: 0 })).toEqual({ x: 60, y: 80 });
  });
});

describe('computeView', () => {
  const grid = { width: 7200, height: 4800 };
  const campus = { x: 3600, y: 2400 };

  it('always covers the viewport, whatever the focal point', () => {
    const view = computeView(grid, campus, { width: 1440, height: 900 }, { focalX: 0.95, focalY: 0.05, zoom: 1 });

    expect(view.offsetX).toBeLessThanOrEqual(0);
    expect(view.offsetY).toBeLessThanOrEqual(0);
    expect(view.offsetX + grid.width * view.scale).toBeGreaterThanOrEqual(1440);
    expect(view.offsetY + grid.height * view.scale).toBeGreaterThanOrEqual(900);
  });

  it('puts the campus on the focal point when there is room', () => {
    const view = computeView(grid, campus, { width: 1440, height: 900 }, { focalX: 0.66, focalY: 0.44, zoom: 1.34 });
    const screen = toScreen(view, campus, { x: 0, y: 0 });

    expect(screen.x).toBeCloseTo(0.66 * 1440, 3);
    expect(screen.y).toBeCloseTo(0.44 * 900, 3);
  });

  it('fills a tall phone screen by height', () => {
    const view = computeView(grid, campus, { width: 390, height: 844 }, { focalX: 0.5, focalY: 0.5, zoom: 1 });

    expect(view.scale).toBeCloseTo(844 / 4800, 6);
  });

  it('tests screen bounds with a margin', () => {
    const view = computeView(grid, campus, { width: 100, height: 100 }, { focalX: 0.5, focalY: 0.5, zoom: 1 });

    expect(isOnScreen(view, 50, 50, 0)).toBe(true);
    expect(isOnScreen(view, -10, 50, 0)).toBe(false);
    expect(isOnScreen(view, -10, 50, 20)).toBe(true);
  });
});

describe('agents', () => {
  const graph = buildGraph(sample);
  const scratch = { x: 0, y: 0 };

  it('spawns on one of the candidate edges', () => {
    const agent = createAgent();

    spawn(agent, graph, [2], fixed(0.4));

    expect(agent.edge).toBe(2);
    expect(agent.s).toBeCloseTo(32);
    expect(agent.trailCount).toBe(0);
  });

  it('turns onto a connected road at a junction instead of reversing', () => {
    const agent = createAgent();
    spawn(agent, graph, [0], fixed(0.1));
    agent.forward = true;
    agent.s = 59.9;
    agent.life = 100;

    const result = step(agent, graph, 0.1, 1, fixed(0), scratch);

    expect(result).toBe('turned');
    expect(agent.edge).toBe(1);
    expect(agent.forward).toBe(true);
    expect(agent.s).toBeGreaterThan(0);
  });

  it('ends at a dead end and when its life runs out', () => {
    const deadEnd = createAgent();
    spawn(deadEnd, graph, [2], fixed(0.1));
    deadEnd.forward = true;
    deadEnd.s = 79.9;
    deadEnd.life = 100;
    const expired = createAgent();
    spawn(expired, graph, [0], fixed(0.1));
    expired.age = expired.life;

    expect(step(deadEnd, graph, 0.5, 1, fixed(0), scratch)).toBe('ended');
    expect(step(expired, graph, 0.016, 1, fixed(0), scratch)).toBe('ended');
  });

  it('records a trail and fades in from zero', () => {
    const agent = createAgent();
    spawn(agent, graph, [0], fixed(0.5));
    agent.forward = true;
    agent.life = 100;

    expect(visibility(agent)).toBe(0);
    for (let i = 0; i < 5; i += 1) step(agent, graph, 0.04, 1, fixed(0.5), scratch);

    expect(agent.trailCount).toBe(5);
    expect(trailIndex(agent, 0)).toBe(4);
    expect(trailIndex(agent, 5)).toBe(-1);
    expect(visibility(agent)).toBeGreaterThan(0);
  });
});
