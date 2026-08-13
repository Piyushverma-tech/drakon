import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ReentryTierFilter = 'all' | 'critical' | 'warning' | 'nominal';
export type ReentrySourceFilter = 'all' | 'trend' | 'single' | 'tip';
export type ReentryTriageFilter = 'new_escalated' | 'active' | 'watching';

export type ReentryScreeningState = {
  tierFilter: ReentryTierFilter;
  sourceFilter: ReentrySourceFilter;
  triageFilter: ReentryTriageFilter;
};

const initialState: ReentryScreeningState = {
  tierFilter: 'all',
  sourceFilter: 'all',
  triageFilter: 'active',
};

const reentryScreeningSlice = createSlice({
  name: 'reentryScreening',
  initialState,
  reducers: {
    setReentryTierFilter(state, action: PayloadAction<ReentryTierFilter>) {
      state.tierFilter = action.payload;
    },
    setReentrySourceFilter(state, action: PayloadAction<ReentrySourceFilter>) {
      state.sourceFilter = action.payload;
    },
    setReentryTriageFilter(state, action: PayloadAction<ReentryTriageFilter>) {
      state.triageFilter = action.payload;
    },
  },
});

export const {
  setReentryTierFilter,
  setReentrySourceFilter,
  setReentryTriageFilter,
} = reentryScreeningSlice.actions;

export default reentryScreeningSlice.reducer;
