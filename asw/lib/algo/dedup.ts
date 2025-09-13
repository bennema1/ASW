const buckets = new Map<number,string[]>();
function simhash64(s:string): bigint {
  const v = new Array(64).fill(0);
  for (const ch of s) {
    const h = BigInt.asUintN(64, BigInt(ch.charCodeAt(0) * 1315423911));
    for (let i=0;i<64;i++) v[i] += ((h >> BigInt(i)) & 1n) ? 1 : -1;
  }
  let out = 0n; for (let i=0;i<64;i++) if (v[i]>0) out |= (1n << BigInt(i));
  return out;
}
export function simHashSeen(title:string): boolean {
  const h = simhash64(title);
  const band = Number(h & 0xFFn);
  const arr = buckets.get(band) ?? [];
  if (arr.some(t => t.toLowerCase() === title.toLowerCase())) return true;
  arr.push(title); buckets.set(band, arr); return false;
}
