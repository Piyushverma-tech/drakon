import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { TleEntry } from './tle-context';

export type TleState = {
  entries: TleEntry[];
  searchQuery: string;
  searchResults: TleEntry[];
};

const initialState: TleState = {
  entries: [],
  searchQuery: '',
  searchResults: [],
};

const tleSlice = createSlice({
  name: 'tle',
  initialState,
  reducers: {
    setEntries(state, action: PayloadAction<TleEntry[]>) {
      state.entries = action.payload;
    },
    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },
    setSearchResults(state, action: PayloadAction<TleEntry[]>) {
      state.searchResults = action.payload;
    },
    clearSearch(state) {
      state.searchQuery = '';
      state.searchResults = [];
    },
  },
});

export const { setEntries, setSearchQuery, setSearchResults, clearSearch } =
  tleSlice.actions;

export default tleSlice.reducer;


