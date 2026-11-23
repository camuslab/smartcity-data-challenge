#!/usr/bin/env node
// Builds public/data/roads-<area>.json for every area in src/data/hero-scenes.json: the road
// network around a centre point as a compact graph on an integer grid (1 unit = 1 m, y south).
//   node scripts/build-roads.mjs [--area <id>] [--refresh] [--preview <svg path>]
// --refresh downloads the raw response first; --preview needs --area.
// Dependency-free (Node 22+). Same raw cache in, byte-identical JSON out.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CACHE_DIR, loadAreas, pathsFor } from './road-areas.mjs';

// ---------------------------------------------------------------- constants

const CAMPUS_SEARCH_RADIUS_M = 1500;
const CAMPUS_MAX_SHIFT_M = 600;

const BBOX_WIDTH_M = 7200;
const BBOX_HEIGHT_M = 4800;
const GRID_WIDTH = 7200;
const GRID_HEIGHT = 4800;
// The download covers the approximate bbox plus this margin, so the bbox can be
// re-centred on the verified campus centroid without a second request.
const FETCH_MARGIN_M = 700;

const EARTH_RADIUS_M = 6371008.8;
const METERS_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;
const DEGREE_DECIMALS = 6;

const HIGHWAY_CLASS = Object.freeze({
  motorway: 0, motorway_link: 0, trunk: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2, tertiary: 2, tertiary_link: 2,
  unclassified: 3, residential: 3, living_street: 3,
});
const CLASS_COUNT = 4;

const MIN_COMPONENT_LENGTH = 150;
const SIZE_BUDGET_BYTES = 320 * 1000;
// Tried in order until the output fits the size budget; nothing is dropped beyond this.
const SIMPLIFY_LADDER = Object.freeze([
  { dpTolerance: 4, stubMinLength: 25 },
  { dpTolerance: 5, stubMinLength: 30 },
  { dpTolerance: 6, stubMinLength: 35 },
  { dpTolerance: 7, stubMinLength: 40 },
  { dpTolerance: 8, stubMinLength: 50 },
]);

const OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]);
const USER_AGENT = 'roads-build-script/1.0';
const QUERY_TIMEOUT_S = 60;
const REQUEST_TIMEOUT_MS = 90_000;
// "Server busy" answers are retried on the same endpoint with exponential backoff;
// anything else (timeouts, malformed bodies) moves straight on to the next endpoint.
const RETRYABLE_STATUS = Object.freeze([429, 502, 503, 504]);
const ATTEMPTS_PER_ENDPOINT = 4;
const RETRY_BACKOFF_MS = 5000;

const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
const CACHE_GITIGNORE_PATH = join(CACHE_DIR, '.gitignore');

const PREVIEW_BACKGROUND = '#080C16';
const PREVIEW_CAMPUS_COLOR = '#FFB300';
const PREVIEW_CAMPUS_RADIUS = 32;
const PREVIEW_PIXEL_WIDTH = 1440;
// Indexed by class code; drawn minor classes first.
const PREVIEW_STROKES = Object.freeze([
  { color: '#FFFFFF', width: 13, opacity: 1 },
  { color: '#DCE6FA', width: 9, opacity: 0.9 },
  { color: '#B7C6E6', width: 6, opacity: 0.8 },
  { color: '#93A5C8', width: 4, opacity: 0.65 },
]);

// ---------------------------------------------------------------- geometry

const toRadians = (deg) => (deg * Math.PI) / 180;
const roundDegrees = (deg) => Number(deg.toFixed(DEGREE_DECIMALS));

function boxAround(centre, widthM, heightM) {
  const halfLat = heightM / 2 / METERS_PER_DEG;
  const halfLon = widthM / 2 / (METERS_PER_DEG * Math.cos(toRadians(centre.lat)));
  return {
    west: roundDegrees(centre.lon - halfLon),
    south: roundDegrees(centre.lat - halfLat),
    east: roundDegrees(centre.lon + halfLon),
    north: roundDegrees(centre.lat + halfLat),
  };
}

/** Planar offset in metres (east, north) of `point` from `origin`. */
function offsetMetres(origin, point) {
  const east = (point.lon - origin.lon) * METERS_PER_DEG * Math.cos(toRadians(origin.lat));
  const north = (point.lat - origin.lat) * METERS_PER_DEG;
  return [east, north];
}

/** Equirectangular projection: origin at the NW corner, x east, y south. */
function makeProjector(bbox) {
  const scaleX = GRID_WIDTH / (bbox.east - bbox.west);
  const scaleY = GRID_HEIGHT / (bbox.north - bbox.south);
  return ({ lat, lon }) => [(lon - bbox.west) * scaleX, (bbox.north - lat) * scaleY];
}

function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Liang–Barsky: parameter range [t0, t1] of segment p→q inside the grid, or null. */
function clipSegment(p, q) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const checks = [
    [-dx, p[0]], [dx, GRID_WIDTH - p[0]],
    [-dy, p[1]], [dy, GRID_HEIGHT - p[1]],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [denominator, numerator] of checks) {
    if (denominator === 0) {
      if (numerator < 0) return null;
    } else if (denominator < 0) {
      t0 = Math.max(t0, numerator / denominator);
    } else {
      t1 = Math.min(t1, numerator / denominator);
    }
  }
  return t0 < t1 ? [t0, t1] : null;
}

/** Douglas–Peucker on an open polyline (endpoints always kept). */
function simplifyOpen(pts, tolerance) {
  const last = pts.length - 1;
  let worst = 0;
  let worstDistance = tolerance;
  for (let i = 1; i < last; i += 1) {
    const distance = distanceToSegment(pts[i], pts[0], pts[last]);
    if (distance > worstDistance) {
      worst = i;
      worstDistance = distance;
    }
  }
  if (worst === 0) return [pts[0], pts[last]];
  const head = simplifyOpen(pts.slice(0, worst + 1), tolerance);
  return [...head.slice(0, -1), ...simplifyOpen(pts.slice(worst), tolerance)];
}

/** Douglas–Peucker; closed polylines are split at the point farthest from the start. */
function simplifyPolyline(pts, tolerance) {
  if (pts.length <= 2) return pts;
  const last = pts[pts.length - 1];
  if (pts[0][0] !== last[0] || pts[0][1] !== last[1]) return simplifyOpen(pts, tolerance);
  const distances = pts.map((p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]));
  const farthest = distances.indexOf(Math.max(...distances));
  const head = simplifyOpen(pts.slice(0, farthest + 1), tolerance);
  const tail = simplifyOpen(pts.slice(farthest), tolerance);
  return [...head, ...tail.slice(1)];
}

// ---------------------------------------------------------------- download + cache

/** Area covered by the download: the approximate bbox plus FETCH_MARGIN_M on every side. */
const fetchBox = (area) => boxAround(
  area, BBOX_WIDTH_M + 2 * FETCH_MARGIN_M, BBOX_HEIGHT_M + 2 * FETCH_MARGIN_M,
);

/** Guards against a cache that predates a change of the bbox constants. */
function assertCovered(bbox, area) {
  const outer = fetchBox(area);
  const covered = bbox.west >= outer.west && bbox.east <= outer.east
    && bbox.south >= outer.south && bbox.north <= outer.north;
  if (!covered) throw new Error('bbox is not covered by the download area; check the constants and run with --refresh');
}

function buildQuery(area) {
  const outer = fetchBox(area);
  const box = `${outer.south},${outer.west},${outer.north},${outer.east}`;
  const highways = Object.keys(HIGHWAY_CLASS).join('|');
  const lines = [
    `[out:json][timeout:${QUERY_TIMEOUT_S}];`,
    `way["highway"~"^(${highways})$"]["area"!="yes"](${box});`,
    'out geom;',
  ];
  if (area.anchorName === undefined) return lines.join('\n');
  // Areas anchored on a campus also fetch its polygon, to centre the map on it.
  const around = `around:${CAMPUS_SEARCH_RADIUS_M},${area.lat},${area.lon}`;
  return [...lines, `nwr["amenity"="university"]["name"~"${area.anchorName}"](${around});`, 'out geom;'].join('\n');
}

/** Throws unless `text` is a complete Overpass JSON answer containing elements. */
function parseOverpassPayload(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`response is not JSON (${error.message}): ${text.slice(0, 120).trim()}`);
  }
  if (!payload || !Array.isArray(payload.elements)) throw new Error('response has no "elements" array');
  if (typeof payload.remark === 'string' && /error|timed out/i.test(payload.remark)) {
    throw new Error(`server remark: ${payload.remark}`);
  }
  if (payload.elements.length === 0) throw new Error('response contains zero elements');
  return payload;
}

async function requestEndpoint(endpoint, query) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}`);
    error.retryable = RETRYABLE_STATUS.includes(response.status);
    throw error;
  }
  const text = await response.text();
  parseOverpassPayload(text);
  return text;
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** Requests one endpoint, retrying "server busy" answers; throws the last failure. */
async function requestWithRetry(endpoint, query, failures) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      console.error(`[overpass] requesting ${endpoint} (attempt ${attempt})`);
      return await requestEndpoint(endpoint, query);
    } catch (error) {
      const reason = error.cause ? `${error.message} (${error.cause.message})` : error.message;
      console.error(`[overpass] ${endpoint} failed: ${reason}`);
      failures.push(`${endpoint}: ${reason}`);
      if (!error.retryable || attempt >= ATTEMPTS_PER_ENDPOINT) throw error;
      await delay(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
}

async function downloadRaw(query) {
  const failures = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return { endpoint, text: await requestWithRetry(endpoint, query, failures) };
    } catch (error) {
      console.error(`[overpass] giving up on ${endpoint}: ${error.message}`);
    }
  }
  throw new Error(`all Overpass endpoints failed:\n  ${failures.join('\n  ')}`);
}

/** YYYY-MM-DD in the local time zone. */
function localDateString(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

async function refreshCache(area) {
  const paths = pathsFor(area);
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(CACHE_GITIGNORE_PATH)) writeFileSync(CACHE_GITIGNORE_PATH, '*\n!.gitignore\n');
  const { endpoint, text } = await downloadRaw(buildQuery(area));
  const now = new Date();
  const meta = { downloaded: localDateString(now), downloadedAt: now.toISOString(), endpoint };
  writeFileSync(paths.raw, text);
  writeFileSync(paths.rawMeta, `${JSON.stringify(meta, null, 2)}\n`);
  console.error(`[cache] ${area.id}: saved ${text.length} chars from ${endpoint}`);
}

/**
 * Download date of the raw cache, from the sidecar written at download time.
 * No fallback to file mtime: the date ends up in the output, so it must not depend on the machine.
 */
function readDownloadDate(metaPath) {
  if (!existsSync(metaPath)) {
    throw new Error(`${metaPath} is missing; run with --refresh to download the raw data again`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (/^\d{4}-\d{2}-\d{2}$/.test(meta.downloaded ?? '')) return meta.downloaded;
  throw new Error(`${metaPath} has no valid "downloaded" date`);
}

/** Never downloads implicitly: a plain run must not overwrite the committed output with new data. */
async function loadRaw(area, refresh) {
  const paths = pathsFor(area);
  if (refresh) await refreshCache(area);
  if (!existsSync(paths.raw)) {
    throw new Error(`${paths.raw} is missing; run with --refresh to download it from OpenStreetMap`);
  }
  const payload = parseOverpassPayload(readFileSync(paths.raw, 'utf8'));
  return { elements: payload.elements, generated: readDownloadDate(paths.rawMeta) };
}

// ---------------------------------------------------------------- campus anchor

const isFiniteCoord = (point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon);

/** Area centroid of a closed ring of {lat, lon} (shoelace, in degrees relative to the first vertex). */
function ringCentroid(ring) {
  const pts = ring.map((point) => [point.lon - ring[0].lon, point.lat - ring[0].lat]);
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const cross = pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    area2 += cross;
    cx += (pts[i][0] + pts[i + 1][0]) * cross;
    cy += (pts[i][1] + pts[i + 1][1]) * cross;
  }
  const lat = ring[0].lat + cy / (3 * area2);
  const areaM2 = (Math.abs(area2) / 2) * METERS_PER_DEG ** 2 * Math.cos(toRadians(lat));
  return { lat, lon: ring[0].lon + cx / (3 * area2), areaM2 };
}

/**
 * Verified campus anchor: centroid of the largest matching university polygon (closed
 * way) in the raw data, or the approximate point when none is close enough.
 */
function resolveCampus(elements, area) {
  const approx = { lat: area.lat, lon: area.lon, verified: false, shiftM: 0 };
  if (area.anchorName === undefined) return { ...approx, verified: true, note: 'fixed centre point' };
  const isCampusPolygon = (el) => el.type === 'way' && el.tags?.amenity === 'university'
    && (el.tags.name ?? '').includes(area.anchorName)
    && Array.isArray(el.geometry) && el.geometry.length >= 4 && el.geometry.every(isFiniteCoord)
    && el.nodes?.[0] === el.nodes?.at(-1);
  const [best] = elements
    .filter(isCampusPolygon)
    .map((el) => ({ label: `way/${el.id} "${el.tags.name}"`, ...ringCentroid(el.geometry) }))
    .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon))
    .sort((p, q) => q.areaM2 - p.areaM2 || (p.label < q.label ? -1 : 1));
  if (best === undefined) return { ...approx, note: 'no matching university polygon in the raw data' };
  const shiftM = Math.hypot(...offsetMetres(area, best));
  if (shiftM > CAMPUS_MAX_SHIFT_M) {
    return { ...approx, note: `${best.label} centroid is ${shiftM.toFixed(0)} m away (limit ${CAMPUS_MAX_SHIFT_M} m)` };
  }
  return {
    lat: roundDegrees(best.lat), lon: roundDegrees(best.lon), verified: true, shiftM,
    note: `${best.label} polygon centroid, area ${(best.areaM2 / 1e4).toFixed(1)} ha`,
  };
}

// ---------------------------------------------------------------- ways → unit segments

function parseRoadWays(elements) {
  const ways = [];
  for (const el of elements) {
    const cls = el.type === 'way' ? HIGHWAY_CLASS[el.tags?.highway] : undefined;
    if (cls === undefined || el.tags.area === 'yes') continue;
    const valid = Array.isArray(el.nodes) && Array.isArray(el.geometry)
      && el.nodes.length === el.geometry.length && el.nodes.length >= 2
      && el.geometry.every(isFiniteCoord);
    if (!valid) throw new Error(`way/${el.id} has malformed nodes/geometry`);
    ways.push({ id: el.id, cls, nodes: el.nodes, geometry: el.geometry });
  }
  return ways.sort((p, q) => p.id - q.id);
}

const quantise = (value, max) => Math.max(0, Math.min(max, Math.round(value)));
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/**
 * Clips one way to the grid and returns its inside segments as
 * { cls, a, b } where a/b are { id, xy } with quantised integer xy.
 * Points created by a bbox cut get a unique synthetic id (so they become dead-end nodes).
 */
function clipWay(way, project) {
  const pts = way.geometry.map(project);
  const vertex = (id, xy) => ({ id, xy: [quantise(xy[0], GRID_WIDTH), quantise(xy[1], GRID_HEIGHT)] });
  const segments = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const range = clipSegment(pts[i], pts[i + 1]);
    if (range === null) continue;
    const [t0, t1] = range;
    const a = t0 > 0
      ? vertex(`c${way.id}_${i}_0`, lerp(pts[i], pts[i + 1], t0))
      : vertex(`n${way.nodes[i]}`, pts[i]);
    const b = t1 < 1
      ? vertex(`c${way.id}_${i}_1`, lerp(pts[i], pts[i + 1], t1))
      : vertex(`n${way.nodes[i + 1]}`, pts[i + 1]);
    segments.push({ cls: way.cls, a, b });
  }
  return segments;
}

/** Union–find over string ids; the lexicographically smallest id of a set is its root. */
function makeUnionFind() {
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.has(root)) root = parent.get(root);
    return root;
  };
  const union = (p, q) => {
    const [low, high] = [find(p), find(q)].sort();
    if (low !== high) parent.set(high, low);
  };
  return { find, union };
}

/**
 * Turns clipped segments into two-point graph edges { a, b, cls, pts }.
 * Segments that collapse to a single grid point are contracted (their end vertices
 * become one node); duplicate segments keep the most major class.
 */
function buildUnitEdges(segments) {
  const sameXY = (s) => s.a.xy[0] === s.b.xy[0] && s.a.xy[1] === s.b.xy[1];
  const merged = makeUnionFind();
  for (const s of segments) if (sameXY(s)) merged.union(s.a.id, s.b.id);
  const byPair = new Map();
  for (const s of segments) {
    if (sameXY(s)) continue;
    const a = merged.find(s.a.id);
    const b = merged.find(s.b.id);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = byPair.get(key);
    if (existing === undefined || s.cls < existing.cls) {
      byPair.set(key, { a, b, cls: s.cls, pts: [s.a.xy, s.b.xy] });
    }
  }
  return [...byPair.values()];
}

// ---------------------------------------------------------------- graph operations

/** node id → [{ e: edge index, end: 0 for the `a` side | 1 for the `b` side }] */
function buildIncidence(edges) {
  const incidence = new Map();
  edges.forEach((edge, e) => {
    [edge.a, edge.b].forEach((node, end) => {
      if (!incidence.has(node)) incidence.set(node, []);
      incidence.get(node).push({ e, end });
    });
  });
  return incidence;
}

/**
 * Merges chains through degree-2 nodes whose two edges share a class.
 * What remains as a node: junctions (3+), class changes, dead ends and bbox cuts
 * (degree 1), plus one arbitrary-but-deterministic node on each isolated ring.
 */
function mergeChains(edges) {
  const incidence = buildIncidence(edges);
  const used = new Array(edges.length).fill(false);
  const passThrough = (node) => {
    const ends = incidence.get(node);
    return ends.length === 2 && ends[0].e !== ends[1].e && edges[ends[0].e].cls === edges[ends[1].e].cls;
  };
  const walk = (startNode, firstEntry) => {
    const pts = [];
    let entry = firstEntry;
    let node = startNode;
    for (;;) {
      const edge = edges[entry.e];
      used[entry.e] = true;
      const forward = entry.end === 0;
      const oriented = forward ? edge.pts : [...edge.pts].reverse();
      pts.push(...(pts.length === 0 ? oriented : oriented.slice(1)));
      node = forward ? edge.b : edge.a;
      if (!passThrough(node)) break;
      const next = incidence.get(node).find((candidate) => candidate.e !== entry.e);
      if (used[next.e]) break;
      entry = next;
    }
    return { a: startNode, b: node, cls: edges[firstEntry.e].cls, pts };
  };
  const merged = [];
  for (const [node, ends] of incidence) {
    if (passThrough(node)) continue;
    for (const entry of ends) if (!used[entry.e]) merged.push(walk(node, entry));
  }
  edges.forEach((edge, e) => {
    if (!used[e]) merged.push(walk(edge.a, { e, end: 0 }));
  });
  return merged;
}

/** Drops dead-end edges shorter than `minLength`; returns the surviving edges. */
function removeStubs(edges, minLength) {
  const incidence = buildIncidence(edges);
  const degree = (node) => incidence.get(node).length;
  return edges.filter((edge) => {
    const deadEnd = edge.a !== edge.b && (degree(edge.a) === 1 || degree(edge.b) === 1);
    return !(deadEnd && polylineLength(edge.pts) < minLength);
  });
}

/** Merge chains and strip short stubs until nothing changes. */
function pruneStubs(unitEdges, minLength) {
  let edges = mergeChains(unitEdges);
  for (;;) {
    const kept = removeStubs(edges, minLength);
    if (kept.length === edges.length) return edges;
    edges = mergeChains(kept);
  }
}

/** Component label (root node id) for every edge. */
function labelComponents(edges) {
  const components = makeUnionFind();
  for (const edge of edges) components.union(edge.a, edge.b);
  return edges.map((edge) => components.find(edge.a));
}

function removeSmallComponents(edges, minLength) {
  const labels = labelComponents(edges);
  const lengthByLabel = new Map();
  edges.forEach((edge, e) => {
    lengthByLabel.set(labels[e], (lengthByLabel.get(labels[e]) ?? 0) + polylineLength(edge.pts));
  });
  return edges.filter((_, e) => lengthByLabel.get(labels[e]) >= minLength);
}

function compareNumberLists(p, q) {
  const shared = Math.min(p.length, q.length);
  for (let i = 0; i < shared; i += 1) {
    if (p[i] !== q[i]) return p[i] - q[i];
  }
  return p.length - q.length;
}

/** Orients an edge so its coordinate list is the lexicographically smaller direction. */
function canonicalEdge(edge) {
  const forward = edge.pts.flat();
  const backwardPts = [...edge.pts].reverse();
  const backward = backwardPts.flat();
  const order = compareNumberLists(forward, backward) || (edge.a <= edge.b ? -1 : 1);
  return order <= 0
    ? { ...edge, flat: forward }
    : { a: edge.b, b: edge.a, cls: edge.cls, pts: backwardPts, flat: backward };
}

const compareEdges = (p, q) => p.cls - q.cls
  || compareNumberLists(p.flat, q.flat)
  || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0)
  || (p.b < q.b ? -1 : p.b > q.b ? 1 : 0);

/**
 * Simplifies, canonicalises and sorts the edges, then keeps one edge per distinct
 * polyline (the most major class wins). Each survivor carries `source`, its index in `edges`.
 */
function simplifyAndDedupe(edges, tolerance) {
  const simplified = edges
    .map((edge, source) => ({ ...canonicalEdge({ ...edge, pts: simplifyPolyline(edge.pts, tolerance) }), source }))
    .sort(compareEdges);
  const seen = new Set();
  return simplified.filter((edge) => {
    const key = edge.flat.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Full topology pass for one ladder step. Deduplication can turn a junction into a
 * plain degree-2 node, so merging and simplifying repeat (always from the
 * unsimplified geometry) until no coincident edge is left.
 */
function buildEdges(unitEdges, { dpTolerance, stubMinLength }) {
  let edges = removeSmallComponents(pruneStubs(unitEdges, stubMinLength), MIN_COMPONENT_LENGTH);
  for (;;) {
    const unique = simplifyAndDedupe(edges, dpTolerance);
    if (unique.length === edges.length) return unique;
    edges = mergeChains(unique.map((edge) => edges[edge.source]));
  }
}

// ---------------------------------------------------------------- output

function buildOutput(edges, context) {
  const xyByNode = new Map();
  for (const edge of edges) {
    xyByNode.set(edge.a, edge.pts[0]);
    xyByNode.set(edge.b, edge.pts.at(-1));
  }
  const nodeIds = [...xyByNode.keys()].sort((p, q) => {
    const order = compareNumberLists(xyByNode.get(p), xyByNode.get(q));
    return order || (p < q ? -1 : 1);
  });
  const indexByNode = new Map(nodeIds.map((id, index) => [id, index]));
  const byClass = new Array(CLASS_COUNT).fill(0);
  for (const edge of edges) byClass[edge.cls] += 1;
  const { bbox, campusXY, generated } = context;
  return {
    meta: {
      source: ATTRIBUTION,
      generated,
      bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      grid: [GRID_WIDTH, GRID_HEIGHT],
      campus: campusXY,
      counts: { nodes: nodeIds.length, edges: edges.length, byClass },
    },
    nodes: nodeIds.flatMap((id) => xyByNode.get(id)),
    edges: edges.map((edge) => [
      indexByNode.get(edge.a), indexByNode.get(edge.b), edge.cls, edge.pts.slice(1, -1).flat(),
    ]),
  };
}

/** Full polyline of an output edge as [[x, y], ...]. */
function edgePolyline(output, [a, b, , mid]) {
  const pts = [[output.nodes[2 * a], output.nodes[2 * a + 1]]];
  for (let i = 0; i < mid.length; i += 2) pts.push([mid[i], mid[i + 1]]);
  pts.push([output.nodes[2 * b], output.nodes[2 * b + 1]]);
  return pts;
}

/** Throws on any violation of the output contract. */
function validateOutput(output) {
  const nodeCount = output.nodes.length / 2;
  const inGrid = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
  const pointOk = ([x, y]) => inGrid(x, GRID_WIDTH) && inGrid(y, GRID_HEIGHT);
  const fail = (message) => {
    throw new Error(`output validation failed: ${message}`);
  };
  if (!Number.isInteger(nodeCount) || nodeCount !== output.meta.counts.nodes) fail('node count mismatch');
  if (output.edges.length !== output.meta.counts.edges) fail('edge count mismatch');
  if (!pointOk(output.meta.campus)) fail('campus anchor outside the grid');
  for (let i = 0; i < nodeCount; i += 1) {
    if (!pointOk([output.nodes[2 * i], output.nodes[2 * i + 1]])) fail(`node ${i} outside the grid`);
  }
  output.edges.forEach((edge, e) => {
    const [a, b, cls, mid] = edge;
    const indexOk = (index) => Number.isInteger(index) && index >= 0 && index < nodeCount;
    if (!indexOk(a) || !indexOk(b)) fail(`edge ${e} has an out-of-range node index`);
    if (!Number.isInteger(cls) || cls < 0 || cls >= CLASS_COUNT) fail(`edge ${e} has class ${cls}`);
    if (mid.length % 2 !== 0) fail(`edge ${e} has an odd-length mid array`);
    const pts = edgePolyline(output, edge);
    if (!pts.every(pointOk)) fail(`edge ${e} has a point outside the grid`);
    const repeated = pts.some((p, i) => i > 0 && p[0] === pts[i - 1][0] && p[1] === pts[i - 1][1]);
    if (repeated || polylineLength(pts) === 0) fail(`edge ${e} has a zero-length span`);
  });
}

/** Walks the simplification ladder until the serialised output fits the budget. */
function buildWithinBudget(unitEdges, context) {
  for (const step of SIMPLIFY_LADDER) {
    const output = buildOutput(buildEdges(unitEdges, step), context);
    const json = JSON.stringify(output);
    const bytes = Buffer.byteLength(json);
    console.error(`[build] dp=${step.dpTolerance} stub=${step.stubMinLength}: ${bytes} bytes`);
    if (bytes <= SIZE_BUDGET_BYTES) return { output, json, step };
  }
  throw new Error(`output exceeds ${SIZE_BUDGET_BYTES} bytes even at the last simplification step`);
}

// ---------------------------------------------------------------- report

/** Summary statistics (lengths in km; an edge counts for the third holding its x-extent centre). */
function buildReport(output, json, campus, step) {
  const kmPerUnit = BBOX_WIDTH_M / GRID_WIDTH / 1000;
  const degree = new Array(output.nodes.length / 2).fill(0);
  const kmByClass = new Array(CLASS_COUNT).fill(0);
  const edgesByThird = [0, 0, 0];
  const polylines = output.edges.map((edge) => edgePolyline(output, edge));
  const lengths = polylines.map((pts) => polylineLength(pts) * kmPerUnit);
  output.edges.forEach(([a, b, cls], e) => {
    degree[a] += 1;
    degree[b] += 1;
    kmByClass[cls] += lengths[e];
    const xs = polylines[e].map((point) => point[0]);
    const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
    edgesByThird[Math.min(2, Math.floor((centreX / GRID_WIDTH) * 3))] += 1;
  });
  const labels = labelComponents(output.edges.map(([a, b]) => ({ a: String(a), b: String(b) })));
  const kmByComponent = new Map();
  labels.forEach((label, e) => kmByComponent.set(label, (kmByComponent.get(label) ?? 0) + lengths[e]));
  const totalKm = lengths.reduce((sum, value) => sum + value, 0);
  const thirdKm2 = (BBOX_WIDTH_M / 3000) * (BBOX_HEIGHT_M / 1000);
  const countDegree = (test) => degree.filter(test).length;
  const fixed = (value, digits) => Number(value.toFixed(digits));
  return {
    campusLatLon: [campus.lat, campus.lon],
    campusGrid: output.meta.campus,
    campusSource: `${campus.verified ? 'verified' : 'APPROXIMATE POINT KEPT'}: ${campus.note}`,
    campusShiftM: fixed(campus.shiftM, 0),
    bbox: output.meta.bbox,
    generated: output.meta.generated,
    settings: { ...step, minComponentLength: MIN_COMPONENT_LENGTH },
    nodes: degree.length,
    edges: output.edges.length,
    edgesByClass: output.meta.counts.byClass,
    kmByClass: kmByClass.map((value) => fixed(value, 2)),
    totalKm: fixed(totalKm, 2),
    nodeDegree: {
      1: countDegree((d) => d === 1), 2: countDegree((d) => d === 2),
      3: countDegree((d) => d === 3), '4+': countDegree((d) => d >= 4),
    },
    components: kmByComponent.size,
    largestComponentShare: fixed(Math.max(...kmByComponent.values()) / totalKm, 4),
    bytes: Buffer.byteLength(json),
    gzipBytes: gzipSync(json, { level: 9 }).length,
    edgesPerKm2WestMidEast: edgesByThird.map((count) => fixed(count / thirdKm2, 1)),
  };
}

// ---------------------------------------------------------------- preview

function renderPreview(output) {
  const paths = [];
  for (let cls = CLASS_COUNT - 1; cls >= 0; cls -= 1) {
    const d = output.edges
      .filter((edge) => edge[2] === cls)
      .map((edge) => `M${edgePolyline(output, edge).map((p) => p.join(' ')).join('L')}`)
      .join('');
    const { color, width, opacity } = PREVIEW_STROKES[cls];
    paths.push(`<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}"/>`);
  }
  const [cx, cy] = output.meta.campus;
  const height = Math.round((PREVIEW_PIXEL_WIDTH * GRID_HEIGHT) / GRID_WIDTH);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_WIDTH} ${GRID_HEIGHT}"`
      + ` width="${PREVIEW_PIXEL_WIDTH}" height="${height}">`,
    `<rect width="${GRID_WIDTH}" height="${GRID_HEIGHT}" fill="${PREVIEW_BACKGROUND}"/>`,
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>`,
    `<circle cx="${cx}" cy="${cy}" r="${PREVIEW_CAMPUS_RADIUS}" fill="${PREVIEW_CAMPUS_COLOR}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- main

function parseArgs(argv) {
  const options = { refresh: false, preview: null, area: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--refresh') {
      options.refresh = true;
    } else if (argv[i] === '--preview' && argv[i + 1] !== undefined) {
      options.preview = resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--area' && argv[i + 1] !== undefined) {
      options.area = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown or incomplete argument "${argv[i]}" (use --refresh, --area <id>, --preview <path>)`);
    }
  }
  if (options.preview !== null && options.area === null) throw new Error('--preview needs --area <id>');
  return options;
}

function writeFileEnsuringDir(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function buildArea(area, options) {
  const { elements, generated } = await loadRaw(area, options.refresh);
  const campus = resolveCampus(elements, area);
  const bbox = boxAround(campus, BBOX_WIDTH_M, BBOX_HEIGHT_M);
  assertCovered(bbox, area);
  const project = makeProjector(bbox);
  const ways = parseRoadWays(elements);
  const unitEdges = buildUnitEdges(ways.flatMap((way) => clipWay(way, project)));
  if (unitEdges.length === 0) throw new Error(`${area.id}: no road segments fall inside the bbox`);
  const campusXY = project(campus).map(Math.round);
  const { output, json, step } = buildWithinBudget(unitEdges, { bbox, campusXY, generated });
  validateOutput(output);
  const { output: outputPath } = pathsFor(area);
  writeFileEnsuringDir(outputPath, json);
  console.error(`[build] ${area.id}: ${ways.length} ways -> ${outputPath}`);
  for (const [key, value] of Object.entries(buildReport(output, json, campus, step))) {
    console.log(`${key.padEnd(24)} ${JSON.stringify(value)}`);
  }
  if (options.preview !== null) {
    writeFileEnsuringDir(options.preview, renderPreview(output));
    console.error(`[preview] ${options.preview}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // One area after another: the public Overpass servers reject parallel requests.
  for (const area of loadAreas(options.area)) await buildArea(area, options);
}

main().catch((error) => {
  console.error(`build-roads failed: ${error.message}`);
  process.exitCode = 1;
});
