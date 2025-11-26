export type TleEntry = {
  id: number;
  name: string;
  l1: string;
  l2: string;
  inclination: number;
  tleEpoch: string;
  isDebris?: boolean;
};
