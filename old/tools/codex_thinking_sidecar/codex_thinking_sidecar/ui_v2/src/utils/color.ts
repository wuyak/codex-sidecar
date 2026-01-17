export function hashHue(s: string): number {
  const str = String(s ?? "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

export function colorForKey(key: string): { fg: string; border: string } {
  const hue = hashHue(key);
  return {
    fg: `hsl(${hue} 85% 42%)`,
    border: `hsla(${hue} 85% 42% / .45)`,
  };
}

