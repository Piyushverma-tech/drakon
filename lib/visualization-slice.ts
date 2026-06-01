import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { MAX_SELECTED } from './satellite-colors';

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

  // Multi-selected satellites
  selectedSatelliteIds: number[];
  focusedSatelliteId: number | null;
  followingSatelliteId: number | null;

  simulationOffsetHours: number; // 0 = live
  isSimulating: boolean; // derived: offset > 0
  simLoading: boolean;

  showReentry: boolean;
  viewMode: '3D' | '2D';
};

const initialState: VisualizationState = {
  activeFilters: ['LEO', 'MEO', 'GEO', 'Debris'],
  overviewExpanded: true,
  showBands: false,
  bandInclination: 53,
  bandTolerance: 2,
  showDensity: false,
  densityRadiusKm: 75,
  selectedSatelliteIds: [],
  focusedSatelliteId: null,
  followingSatelliteId: null,
  simulationOffsetHours: 0,
  isSimulating: false,
  simLoading: false,
  showReentry: false,
  viewMode: '3D',
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
        state.showReentry = false;
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
        state.showReentry = false;
      }
    },
    setDensityRadiusKm(state, action: PayloadAction<number>) {
      state.densityRadiusKm = action.payload;
    },
    selectSatellite(state, action: PayloadAction<number>) {
      const satId = action.payload;
      const existingIdx = state.selectedSatelliteIds.indexOf(satId);
      if (existingIdx === -1) {
        if (state.selectedSatelliteIds.length >= MAX_SELECTED) return;
        state.selectedSatelliteIds.push(satId);
      }
      if (state.followingSatelliteId !== satId) {
        state.followingSatelliteId = null;
      }
      state.focusedSatelliteId = satId;
    },
    focusSelectedSatellite(state, action: PayloadAction<number>) {
      const satId = action.payload;
      if (!state.selectedSatelliteIds.includes(satId)) return;
      if (state.followingSatelliteId !== satId) {
        state.followingSatelliteId = null;
      }
      state.focusedSatelliteId = satId;
    },
    removeSelectedSatellite(state, action: PayloadAction<number>) {
      const satId = action.payload;
      const nextIds = state.selectedSatelliteIds.filter((id) => id !== satId);
      const nextFocus =
        state.focusedSatelliteId === satId
          ? (nextIds.at(-1) ?? null)
          : state.focusedSatelliteId;

      state.selectedSatelliteIds = nextIds;
      state.focusedSatelliteId = nextFocus;

      if (state.followingSatelliteId === satId) {
        state.followingSatelliteId = null;
      }
    },
    toggleFollowingFocusedSatellite(state) {
      const focusedId = state.focusedSatelliteId;
      if (!focusedId) return;
      state.followingSatelliteId =
        state.followingSatelliteId === focusedId ? null : focusedId;
    },
    // Simulation state
    setSimulationOffset(state, action: PayloadAction<number>) {
      state.simulationOffsetHours = action.payload;
      state.isSimulating = action.payload > 0;
    },
    resetSimulation(state) {
      state.simulationOffsetHours = 0;
      state.isSimulating = false;
    },
    setSimLoading(state, action: PayloadAction<boolean>) {
      state.simLoading = action.payload;
    },
    setShowReentry(state, action: PayloadAction<boolean>) {
      state.showReentry = action.payload;
      // disable bands when reentry is enabled
      if (action.payload) {
        state.showBands = false;
        state.showDensity = false;
      }
    },
    setViewMode(state, action: PayloadAction<'3D' | '2D'>) {
      state.viewMode = action.payload;
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
  selectSatellite,
  focusSelectedSatellite,
  removeSelectedSatellite,
  toggleFollowingFocusedSatellite,
  setSimulationOffset,
  resetSimulation,
  setSimLoading,
  setShowReentry,
  setViewMode,
} = visualizationSlice.actions;

export default visualizationSlice.reducer;
