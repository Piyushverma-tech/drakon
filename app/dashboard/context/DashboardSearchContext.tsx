'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type DashboardSearchContextValue = {
  query: string;
  setQuery: (query: string) => void;
  placeholder: string;
  setPlaceholder: (placeholder: string) => void;
  clearQuery: () => void;
};

const DashboardSearchContext = createContext<DashboardSearchContextValue | null>(
  null
);

export function DashboardSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState('Search...');

  const clearQuery = useCallback(() => setQuery(''), []);

  const value = useMemo(
    () => ({
      query,
      setQuery,
      placeholder,
      setPlaceholder,
      clearQuery,
    }),
    [query, placeholder, clearQuery]
  );

  return (
    <DashboardSearchContext.Provider value={value}>
      {children}
    </DashboardSearchContext.Provider>
  );
}

export function useDashboardSearchContext() {
  const context = useContext(DashboardSearchContext);
  if (!context) {
    throw new Error(
      'useDashboardSearchContext must be used within DashboardSearchProvider'
    );
  }
  return context;
}

export function useModuleSearch(placeholder: string) {
  const { query, setQuery, setPlaceholder, clearQuery } =
    useDashboardSearchContext();

  useEffect(() => {
    setPlaceholder(placeholder);
    setQuery('');
  }, [placeholder, setPlaceholder, setQuery]);

  return { query, setQuery, clearQuery };
}
