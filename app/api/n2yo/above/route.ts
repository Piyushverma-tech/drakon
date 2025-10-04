import { NextResponse } from 'next/server';

// Proxy to N2YO to avoid exposing API key client-side and handle CORS
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat') ?? '0';
  const lon = searchParams.get('lon') ?? '0';
  const alt = searchParams.get('alt') ?? '0';
  const radius = searchParams.get('radius') ?? '90'; // degrees
  const category = searchParams.get('category') ?? '0'; // all

  const apiKey = process.env.N2YO_API_KEY ?? process.env.N2YO_API_KEY;
  if (!apiKey) {
    return new NextResponse(JSON.stringify({ above: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-n2yo-mock': '1' },
    });
  }

  const url = `https://api.n2yo.com/rest/v1/satellite/above/${lat}/${lon}/${alt}/${radius}/${category}/?apiKey=${apiKey}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream error ${res.status}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reach N2YO' },
      { status: 502 }
    );
    console.log(error);
  }
}
