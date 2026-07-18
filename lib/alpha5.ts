// CelesTrak/Space-Track Alpha-5: encodes catalog numbers 100000–339999 into
// the TLE's fixed 5-character field by replacing the leading digit with a
// letter (I and O excluded to avoid confusion with 1 and 0).
// A0000=100000 ... S9999=269999 ... Z9999=339999
const ALPHA5_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function decodeAlpha5CatalogNumber(field: string): number | null {
  const trimmed = field.trim();
  if (!trimmed) return null;

  const first = trimmed[0];
  if (first >= '0' && first <= '9') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  const letterIndex = ALPHA5_LETTERS.indexOf(first.toUpperCase());
  if (letterIndex === -1) return null; // I, O, or non-alpha junk

  const rest = trimmed.slice(1);
  if (!/^\d{4}$/.test(rest)) return null;

  return (letterIndex + 10) * 10000 + Number(rest);
}
