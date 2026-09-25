export type Point = [x: number, y: number];

/**
 * Smooth line through points without overshooting (monotone cubic interpolation), so a
 * day with zero cases never dips below the baseline the way a plain spline would.
 */
export function smoothPath(pts: Point[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]![0]},${pts[0]![1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    slope.push((pts[i + 1]![1] - pts[i]![1]) / dx[i]!);
  }
  const t = pts.map((_, i) => {
    if (i === 0) return slope[0]!;
    if (i === n - 1) return slope[n - 2]!;
    const a = slope[i - 1]!;
    const b = slope[i]!;
    if (a * b <= 0) return 0;
    return (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b);
  });
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += ` C${x0 + h},${y0 + t[i]! * h} ${x1 - h},${y1 - t[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

/** A tidy upper bound for an axis: 4 steps of a round number. */
export function niceMax(max: number, steps = 4): number {
  if (max <= steps) return steps;
  const raw = max / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return step * steps;
}

/** Straight segments: honest for small whole-number counts, where a curve would invent in-between values. */
export const linePath = (pts: Point[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
