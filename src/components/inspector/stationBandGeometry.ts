import type { Line, LineStyle, Station, StationId } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { resolveSegmentStyle } from '../../geometry/interlining';

// Row + gap heights for the LineInspector's stop band (px). Exported so the
// component's row markup and this geometry stay in lockstep.
export const STATION_ROW_H = 20;
export const GAP_ROW_H = 16;
export const BAND_W = 14;

export interface BandSegment {
  i: number;
  sid: string;
  nextSid: string;
  style: LineStyle;
  y1: number;
  y2: number;
}

export interface StationBandLayout {
  totalHeight: number;
  centerOf: (idx: number) => number;
  segments: BandSegment[];
}

/**
 * Vertical layout for the LineInspector's stop band: each station row's center
 * y, the total band height, and the styled segment spans. The first/last
 * segment is capped half the RENDERED band-width past the end dot so the band
 * visually reaches the terminus at whatever width the preview paints. Pure —
 * depends only on the line's station order, which stations
 * currently exist, the per-segment styles, and the preview width.
 */
export function stationBandLayout(
  line: Line,
  stations: Record<StationId, Station>,
  bandW: number = BAND_W,
): StationBandLayout {
  const N = line.stations.length;
  const cap = bandW / 2;
  const centerOf = (idx: number) => idx * (STATION_ROW_H + GAP_ROW_H) + STATION_ROW_H / 2;
  const totalHeight = N * STATION_ROW_H + Math.max(0, N - 1) * GAP_ROW_H;
  const segments: BandSegment[] = [];
  for (let i = 0; i < N - 1; i++) {
    const sid = line.stations[i];
    const nextSid = line.stations[i + 1];
    if (!stations[sid] || !stations[nextSid]) continue;
    const style = resolveSegmentStyle(line, pairKeyOf(sid, nextSid));
    const y1 = i === 0 ? centerOf(0) - cap : centerOf(i);
    const y2 = i === N - 2 ? centerOf(N - 1) + cap : centerOf(i + 1);
    segments.push({ i, sid, nextSid, style, y1, y2 });
  }
  return { totalHeight, centerOf, segments };
}
