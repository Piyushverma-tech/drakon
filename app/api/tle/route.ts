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
  const format = searchParams.get('format') || 'tle';

  const effectiveGroups =
    groups.length > 0 ? groups : ['visual', '1999-025', 'iridium-33-debris']; // default small set

  try {
    const results = [];
    for (const g of effectiveGroups) {
      const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(
        g
      )}&FORMAT=${format}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        results.push(await res.text());
      }
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    }

    const combined = results.filter(Boolean).join('\n');
    return new NextResponse(combined, {
      headers: { 'content-type': 'text/plain' },
    });
  } catch (err) {
    console.error('Error fetching TLE data', err);
    return NextResponse.json({ error: 'failed to fetch tle' }, { status: 500 });
  }
}
