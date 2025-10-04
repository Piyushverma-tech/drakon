import { NextResponse } from 'next/server';

// Proxy TLEs from Celestrak. Supports multiple groups and a limit.
// Examples:
//   /api/tle?group=visual
//   /api/tle?group=starlink&group=oneweb
//   /api/tle?group=1999-025   (Cosmos-2251 debris)
//   /api/tle?group=iridium-33-debris
//   /api/tle?group=active&limit=1000
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const groups = searchParams.getAll('group');
  const limit = Number(searchParams.get('limit') ?? '0');

  const effectiveGroups =
    groups.length > 0 ? groups : ['visual', '1999-025', 'iridium-33-debris']; // default small set

  try {
    const texts = await Promise.all(
      effectiveGroups.map(async (g) => {
        const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(
          g
        )}&FORMAT=tle`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return '';
        return await res.text();
      })
    );
    let combined = texts.filter(Boolean).join('\n');
    if (limit > 0) {
      const lines = combined
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, limit * 3);
      combined = lines.join('\n');
    }
    return new NextResponse(combined, {
      headers: { 'content-type': 'text/plain' },
      status: 200,
    });
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 502 });
  }
}
