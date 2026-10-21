/** Typical Indian residential storey. Never extrude a 0 m wall. */
export function saneStoreyHeight(n: number | undefined): number {
  if (!Number.isFinite(n) || n === undefined || n < 2.4 || n > 6) return 3;
  return n;
}
