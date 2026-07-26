// Provider-agnostic contract for fetching TLE/3LE data.

export type ProviderName = 'celestrak' | 'spacetrack' | 'mock';

export interface TleFetchOptions {
  /** CelesTrak-style named groups (e.g. 'active', 'iridium-33-debris'). Ignored by SpaceTrackProvider. */
  groups?: string[];
  /**
   * Widen the query window so the result is authoritative enough to prune
   * from (i.e. treat objects missing from the result as gone). Only
   * SpaceTrackProvider currently distinguishes this from a normal poll.
   */
  fullResync?: boolean;
  /**
   * TLE line format. Default to '3le' explicitly rather than relying on
   * 'tle' alone — see spacetrack.ts for why the two are NOT interchangeable
   * on Space-Track the way they are on CelesTrak.
   */
  format?: 'tle' | '3le';
}

export interface TleFetchResult {
  raw: string;
  provider: ProviderName;
  fetchedAt: Date;
  objectCount: number;
}

export interface TLEProvider {
  readonly name: ProviderName;
  fetch(options?: TleFetchOptions): Promise<TleFetchResult>;
}
