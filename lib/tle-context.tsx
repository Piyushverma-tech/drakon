export type TleEntry = {
  id: number;
  name: string;
  operator: string;
  l1: string;
  l2: string;
  inclination: number;
  meanMotion: number;
  tleEpoch: string;
  isDebris?: boolean;
};
