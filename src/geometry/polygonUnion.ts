// Polygon union of two convex polygons — used to compute the merged
// silhouette of a station's cells rect + (rotated) label rect for selection
// rendering.
//
// Approach: split each edge by intersections with the other polygon, keep
// only segments whose midpoint is OUTSIDE the other polygon (boundary
// midpoints count as inside, so a shared edge isn't kept twice in opposing
// directions). Then stitch the kept segments head-to-tail.

export type Pt = { x: number; y: number };

const EPS = 1e-6;
// Looser threshold for matching segment endpoints during stitching — handles
// fp drift between an intersection point computed once on A's edge and once
// on B's edge (they should agree but can differ by ~1e-12 to ~1e-9).
const STITCH_EPS = 1e-3;
// How far off an edge to step when asking which side of it the other polygon
// is on. Small enough to stay inside any polygon we union here, far enough
// clear of EPS that the inside test is decisive.
const PROBE = 1e-3;

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Normalize to interior-on-the-left winding: "CCW" in the math y-up sense,
// which is visually CLOCKWISE in this codebase's y-down screen frame. The
// inside tests below (cross >= EPS per directed edge) assume this orientation —
// a reader comparing against rendered shapes will see the winding "backwards".
function ensureCCW(poly: Pt[]): Pt[] {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return sum > 0 ? [...poly].reverse() : poly;
}

// True if `p` is strictly inside `poly`. Boundary points return false.
function isStrictlyInsideCCW(p: Pt, poly: Pt[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (cross(a, b, p) < EPS) return false;
  }
  return true;
}

// True if `p` is strictly inside `poly` OR on its boundary.
function isInsideOrOnBoundaryCCW(p: Pt, poly: Pt[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (cross(a, b, p) < -EPS) return false;
  }
  return true;
}

// True if `other` sits on the OUTWARD side of self's directed edge a→b, probed
// just off the segment midpoint. Interior is on the left, so outward is the
// right normal. Only meaningful for a segment that lies ON other's boundary:
// it separates the two polygons merely TOUCHING along that edge (other is
// across it, so the edge is interior to the union) from them overlapping past
// it (other is behind, so the edge really is on the union's outline).
function otherIsAcrossEdge(a: Pt, b: Pt, mid: Pt, other: Pt[]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return false;
  const probe = { x: mid.x + (dy / len) * PROBE, y: mid.y - (dx / len) * PROBE };
  return isStrictlyInsideCCW(probe, other);
}

interface Hit {
  x: number;
  y: number;
  t1: number;
  t2: number;
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Hit | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;
  const t1 = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const t2 = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t1 < -EPS || t1 > 1 + EPS || t2 < -EPS || t2 > 1 + EPS) return null;
  return { x: p1.x + d1x * t1, y: p1.y + d1y * t1, t1, t2 };
}

interface Segment {
  start: Pt;
  end: Pt;
}

interface Crossing {
  aEdge: number;
  bEdge: number;
  x: number;
  y: number;
  tA: number;
  tB: number;
}

// Find every edge-edge crossing once. Storing the SAME (x, y) for use by
// both polygons is essential — computing the crossing twice (once from each
// polygon's perspective) drifts by ~0.01 in fp, breaking endpoint matching
// during stitching.
function findCrossings(A: Pt[], B: Pt[]): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i];
    const a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j];
      const b2 = B[(j + 1) % B.length];
      const h = segIntersect(a1, a2, b1, b2);
      if (h) {
        out.push({ aEdge: i, bEdge: j, x: h.x, y: h.y, tA: h.t1, tB: h.t2 });
      }
    }
  }
  return out;
}

function collectKeptSegments(
  self: Pt[],
  other: Pt[],
  crossings: Crossing[],
  selfIsA: boolean,
): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < self.length; i++) {
    const p = self[i];
    const q = self[(i + 1) % self.length];
    const splits = crossings
      .filter((c) => (selfIsA ? c.aEdge : c.bEdge) === i)
      .map((c) => ({ t: selfIsA ? c.tA : c.tB, pt: { x: c.x, y: c.y } }))
      .sort((a, b) => a.t - b.t);

    const points: Pt[] = [p, ...splits.map((s) => s.pt), q];
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k];
      const b = points[k + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Asymmetric: A keeps shared-edge segments (boundary midpoints),
      // B drops them. This way each shared edge is contributed exactly once
      // — by A — instead of twice (causing gap or duplicate during stitch).
      // Unless the polygons only MEET along that edge: then it is interior to
      // the union and A must give it up too, or A closes a ring on its own
      // segments and B's survivors are stranded as an unstitchable open chain.
      const dropIfInside = selfIsA
        ? isStrictlyInsideCCW(mid, other) || otherIsAcrossEdge(a, b, mid, other)
        : isInsideOrOnBoundaryCCW(mid, other);
      if (!dropIfInside) {
        out.push({ start: a, end: b });
      }
    }
  }
  return out;
}

// Stitches segments into closed polygons. Doesn't mark a segment as used
// until a full cycle closes — that way a wrong greedy first-match doesn't
// strand other segments. Returns the polygons in the order they're closed.
function stitch(segs: Segment[]): Pt[][] {
  const used = new Array(segs.length).fill(false);
  const polys: Pt[][] = [];

  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;

    const visited: number[] = [];
    const poly: Pt[] = [];
    let curr = s;
    let success = false;
    let safety = segs.length + 4;

    while (safety-- > 0) {
      if (visited.includes(curr)) break;
      visited.push(curr);
      const last = poly[poly.length - 1];
      if (
        !last ||
        Math.hypot(last.x - segs[curr].start.x, last.y - segs[curr].start.y) > STITCH_EPS
      ) {
        poly.push(segs[curr].start);
      }

      const target = segs[curr].end;
      // Closed back to start of the cycle?
      if (
        poly.length > 1 &&
        Math.hypot(target.x - segs[s].start.x, target.y - segs[s].start.y) < STITCH_EPS
      ) {
        success = true;
        break;
      }

      let next = -1;
      for (let i = 0; i < segs.length; i++) {
        if (used[i] || visited.includes(i)) continue;
        const ds = segs[i].start;
        if (Math.hypot(ds.x - target.x, ds.y - target.y) < STITCH_EPS) {
          next = i;
          break;
        }
      }
      if (next === -1) break;
      curr = next;
    }

    if (success && poly.length >= 3) {
      for (const v of visited) used[v] = true;
      polys.push(poly);
    } else {
      // Don't retry from this start, but leave the rest available.
      used[s] = true;
    }
  }
  return polys;
}

// Remove vertices that lie on the line between their neighbors. Called
// after stitching — when crossings split an edge, both sides of the split
// remain as separate vertices on a straight line, which would smooth into
// an unwanted mini-curve.
function removeCollinear(poly: Pt[]): Pt[] {
  let result = poly;
  for (let pass = 0; pass < poly.length; pass++) {
    const next: Pt[] = [];
    const n = result.length;
    let removed = 0;
    for (let i = 0; i < n; i++) {
      const prev = result[(i + n - 1) % n];
      const curr = result[i];
      const after = result[(i + 1) % n];
      if (Math.abs(cross(prev, curr, after)) > EPS) {
        next.push(curr);
      } else {
        removed++;
      }
    }
    if (removed === 0 || next.length < 3) return next.length >= 3 ? next : result;
    result = next;
  }
  return result;
}

export function unionConvex(rawA: Pt[], rawB: Pt[]): Pt[][] {
  const A = ensureCCW(rawA);
  const B = ensureCCW(rawB);
  const crossings = findCrossings(A, B);
  const segs: Segment[] = [
    ...collectKeptSegments(A, B, crossings, true),
    ...collectKeptSegments(B, A, crossings, false),
  ];
  const polys = stitch(segs)
    .map(removeCollinear)
    .filter((p) => p.length >= 3);
  if (polys.length === 0) {
    // Stitch failed (or no segments). Fall back to rendering both inputs as
    // separate components — visually approximate, but never silent.
    return [A, B];
  }
  return polys;
}

// Render a list of polygons as one SVG path string. If `radius > 0`, every
// vertex becomes a quadratic Bezier (trim point on incoming edge → vertex as
// control → trim point on outgoing edge), which rounds outer convex corners
// AND fillets inner concave junctions in a single pass.
export function polygonsToPath(polys: Pt[][], radius: number = 0): string {
  let d = '';
  for (const poly of polys) {
    if (poly.length >= 3) d += polygonSubpath(poly, radius);
  }
  return d;
}

function polygonSubpath(poly: Pt[], radius: number): string {
  const n = poly.length;
  // Wrap edge included: the closing edge can be degenerate too.
  if (radius <= 0 || hasDegenerateEdge(poly, true)) {
    let d = `M ${fmt(poly[0].x)} ${fmt(poly[0].y)}`;
    for (let i = 1; i < n; i++) d += ` L ${fmt(poly[i].x)} ${fmt(poly[i].y)}`;
    return d + ' Z';
  }

  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];
    const { q1, q2 } = cornerTrimPoints(prev, curr, next, radius);
    if (i === 0) d += `M ${fmt(q1.x)} ${fmt(q1.y)}`;
    else d += ` L ${fmt(q1.x)} ${fmt(q1.y)}`;
    d += ` Q ${fmt(curr.x)} ${fmt(curr.y)} ${fmt(q2.x)} ${fmt(q2.y)}`;
  }
  return d + ' Z';
}

// Render an OPEN vertex chain as an SVG path: stroke runs v0 → v(n-1) with no
// closing edge (no `Z`). When `radius > 0` the interior vertices get the same
// quadratic rounding as polygonSubpath; the two endpoints stay exact so the
// chain visibly starts and ends on its vertices.
export function openPolylinePath(poly: Pt[], radius: number = 0): string {
  const n = poly.length;
  if (n < 2) return '';

  if (radius <= 0 || n === 2 || hasDegenerateEdge(poly, false)) {
    let d = `M ${fmt(poly[0].x)} ${fmt(poly[0].y)}`;
    for (let i = 1; i < n; i++) d += ` L ${fmt(poly[i].x)} ${fmt(poly[i].y)}`;
    return d;
  }

  let d = `M ${fmt(poly[0].x)} ${fmt(poly[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const { q1, q2 } = cornerTrimPoints(poly[i - 1], poly[i], poly[i + 1], radius);
    d += ` L ${fmt(q1.x)} ${fmt(q1.y)} Q ${fmt(poly[i].x)} ${fmt(poly[i].y)} ${fmt(q2.x)} ${fmt(q2.y)}`;
  }
  return d + ` L ${fmt(poly[n - 1].x)} ${fmt(poly[n - 1].y)}`;
}

// True iff any consecutive edge is shorter than EPS; `wrap` also checks the
// closing edge (last vertex back to the first). Degenerate edges would divide
// by ~0 in the corner trim math, so callers fall back to straight segments.
function hasDegenerateEdge(poly: Pt[], wrap: boolean): boolean {
  const last = wrap ? poly.length : poly.length - 1;
  for (let i = 0; i < last; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) return true;
  }
  return false;
}

// The two trim points of a rounded corner at `curr`: q1 sits on the incoming
// edge, q2 on the outgoing edge, each pulled back by the radius clamped to
// half its edge so adjacent corners never overshoot each other.
function cornerTrimPoints(prev: Pt, curr: Pt, next: Pt, radius: number): { q1: Pt; q2: Pt } {
  const inDx = curr.x - prev.x;
  const inDy = curr.y - prev.y;
  const inLen = Math.hypot(inDx, inDy);
  const outDx = next.x - curr.x;
  const outDy = next.y - curr.y;
  const outLen = Math.hypot(outDx, outDy);

  const inTrim = Math.min(radius, inLen / 2);
  const outTrim = Math.min(radius, outLen / 2);

  return {
    q1: { x: curr.x - (inDx / inLen) * inTrim, y: curr.y - (inDy / inLen) * inTrim },
    q2: { x: curr.x + (outDx / outLen) * outTrim, y: curr.y + (outDy / outLen) * outTrim },
  };
}

function fmt(n: number): string {
  return n.toFixed(3);
}
