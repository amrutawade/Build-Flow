import { createHash } from "node:crypto";

const CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

function b64(value: number, size: number): string {
  let s = "";
  let v = value >>> 0;
  for (let i = 0; i < size; i++) {
    s = CHARS[v % 64] + s;
    v = Math.floor(v / 64);
  }
  return s;
}

/** buildingSMART 22-char IFC GUID from 16 bytes. */
function compressBytes(bs: number[]): string {
  return (
    b64(bs[0], 2) +
    b64((bs[1] << 16) | (bs[2] << 8) | bs[3], 4) +
    b64((bs[4] << 16) | (bs[5] << 8) | bs[6], 4) +
    b64((bs[7] << 16) | (bs[8] << 8) | bs[9], 4) +
    b64((bs[10] << 16) | (bs[11] << 8) | bs[12], 4) +
    b64((bs[13] << 16) | (bs[14] << 8) | bs[15], 4)
  );
}

export function ifcGuidFromKey(key: string): string {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 32);
  const bs: number[] = [];
  for (let i = 0; i < 32; i += 2) {
    bs.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return compressBytes(bs);
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0.";
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s.includes(".") ? s : `${s}.`;
}
