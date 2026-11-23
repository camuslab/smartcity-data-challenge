// Areas the road data is built for. The list lives in src/data/hero-scenes.json so the
// site and this build script read the same centres.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = join(ROOT_DIR, 'scripts', '.cache');
const SCENES_PATH = join(ROOT_DIR, 'src', 'data', 'hero-scenes.json');
const ID_PATTERN = /^[a-z0-9-]+$/;

/** File locations for one area: raw download, its date sidecar, and the built output. */
export function pathsFor(area) {
  return {
    raw: join(CACHE_DIR, `osm-raw-${area.id}.json`),
    rawMeta: join(CACHE_DIR, `osm-raw-${area.id}.meta.json`),
    output: join(ROOT_DIR, 'public', 'data', `roads-${area.id}.json`),
  };
}

function assertValidArea(area) {
  const valid = typeof area?.id === 'string' && ID_PATTERN.test(area.id)
    && Number.isFinite(area.lat) && Number.isFinite(area.lon)
    && (area.anchorName === undefined || typeof area.anchorName === 'string');
  if (!valid) throw new Error(`${SCENES_PATH}: invalid area entry ${JSON.stringify(area)}`);
}

/**
 * All areas, or only the one named by `onlyId`.
 * `anchorName` (optional) asks the build to snap the centre to the matching university polygon.
 */
export function loadAreas(onlyId) {
  const areas = JSON.parse(readFileSync(SCENES_PATH, 'utf8'));
  if (!Array.isArray(areas) || areas.length === 0) throw new Error(`${SCENES_PATH}: expected a non-empty list`);
  areas.forEach(assertValidArea);
  if (onlyId === null) return areas;
  const match = areas.filter((area) => area.id === onlyId);
  if (match.length === 0) {
    throw new Error(`unknown area "${onlyId}" (known: ${areas.map((area) => area.id).join(', ')})`);
  }
  return match;
}
