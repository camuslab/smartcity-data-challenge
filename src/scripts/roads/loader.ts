import { buildGraph, type Graph } from './graph';

const graphCache = new Map<string, Promise<Graph>>();

/** 도로망 파일을 받아 그래프로 만든다. 같은 주소는 한 번만 받는다. */
export function loadGraph(url: string): Promise<Graph> {
  const cached = graphCache.get(url);
  if (cached) return cached;
  const pending = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`도로망 데이터를 불러오지 못했습니다 (${response.status}): ${url}`);
    return buildGraph(await response.json());
  });
  graphCache.set(url, pending);
  return pending;
}
