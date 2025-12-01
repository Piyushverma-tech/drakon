import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type VisualizationState = {
  // Filter state
  activeFilters: string[];
  overviewExpanded: boolean;
  
  // Inclination bands state
  showBands: boolean;
  bandInclination: number;
  bandTolerance: number;
  
  // Collision density state
  showDensity: boolean;
  densityRadiusKm: number;
  
  // Selected satellite
  selectedSatelliteId: number | null;
};

const initialState: VisualizationState = {
  activeFilters: ['LEO', 'MEO', 'GEO', 'Debris'],
  overviewExpanded: false,
  showBands: false,
  bandInclination: 53,
  bandTolerance: 2,
  showDensity: false,
  densityRadiusKm: 75,
  selectedSatelliteId: null,
};

const visualizationSlice = createSlice({
  name: 'visualization',
  initialState,
  reducers: {
    setActiveFilters(state, action: PayloadAction<string[]>) {
      state.activeFilters = action.payload;
    },
    toggleFilter(state, action: PayloadAction<string>) {
      const index = state.activeFilters.indexOf(action.payload);
      if (index >= 0) {
        state.activeFilters.splice(index, 1);
      } else {
        state.activeFilters.push(action.payload);
      }
    },
    setOverviewExpanded(state, action: PayloadAction<boolean>) {
      state.overviewExpanded = action.payload;
    },
    setShowBands(state, action: PayloadAction<boolean>) {
      state.showBands = action.payload;
      // disable density when bands are enabled
      if (action.payload) {
        state.showDensity = false;
      }
    },
    setBandInclination(state, action: PayloadAction<number>) {
      state.bandInclination = action.payload;
    },
    setBandTolerance(state, action: PayloadAction<number>) {
      state.bandTolerance = action.payload;
    },
    setShowDensity(state, action: PayloadAction<boolean>) {
      state.showDensity = action.payload;
      // disable bands when density is enabled
      if (action.payload) {
        state.showBands = false;
      }
    },
    setDensityRadiusKm(state, action: PayloadAction<number>) {
      state.densityRadiusKm = action.payload;
    },
    setSelectedSatelliteId(state, action: PayloadAction<number | null>) {
      state.selectedSatelliteId = action.payload;
    },
  },
});

export const {
  setActiveFilters,
  toggleFilter,
  setOverviewExpanded,
  setShowBands,
  setBandInclination,
  setBandTolerance,
  setShowDensity,
  setDensityRadiusKm,
  setSelectedSatelliteId,
} = visualizationSlice.actions;

export default visualizationSlice.reducer;

