'use client';

import React, { createContext, useContext, useRef, useState, ReactNode } from 'react';

export type TleEntry = {
  id: number;
  name: string;
  l1: string;
  l2: string;
  inclination: number;
  tleEpoch: string;
  isDebris?: boolean;
};

type TleContextType = {
  tleRef: React.RefObject<TleEntry[]>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: TleEntry[];
  setSearchResults: (results: TleEntry[]) => void;
};

const TleContext = createContext<TleContextType | undefined>(undefined);

export function TleProvider({ children }: { children: ReactNode }) {
  const tleRef = useRef<TleEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TleEntry[]>([]);

  return (
    <TleContext.Provider
      value={{
        tleRef,
        searchQuery,
        setSearchQuery,
        searchResults,
        setSearchResults,
      }}
    >
      {children}
    </TleContext.Provider>
  );
}

export function useTle() {
  const context = useContext(TleContext);
  if (context === undefined) {
    throw new Error('useTle must be used within a TleProvider');
  }
  return context;
}
