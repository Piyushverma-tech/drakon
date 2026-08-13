'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { TablePagination } from '@/app/dashboard/components/TablePagination';
import type { ReentryRisk, TleEntry } from '@/lib/types';
import type { SortDir, SortKey } from '../lib/constants';
import { ReentryTableRow } from './ReentryTableRow';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className="px-3 py-2.5 font-medium cursor-pointer select-none group"
      onClick={() => onSort(sortKey)}
    >
      <span
        className={`inline-flex items-center gap-1 transition-colors ${
          active ? 'text-cyan-300' : 'text-gray-500 group-hover:text-gray-300'
        }`}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )
        ) : (
          <ChevronDown className="w-3 h-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

type Props = {
  rows: ReentryRisk[];
  entryById: Map<number, TleEntry>;
  selectedSatId: number | null;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onSelect: (satId: number) => void;
};

export function ReentryTable({
  rows,
  entryById,
  selectedSatId,
  sortKey,
  sortDir,
  onSort,
  onSelect,
}: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [rows, sortDir, sortKey]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [page, pageSize, rows]);

  function handlePageSizeChange(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPage(1);
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/40 backdrop-blur-md">
      <div className="overflow-x-auto overflow-y-auto max-h-[280px] no-scrollbar">
        <table className="w-full min-w-[1120px] text-left border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th colSpan={12} className="p-0">
                <div className="h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
              </th>
            </tr>
            <tr className="bg-black backdrop-blur-sm text-[9.5px] uppercase tracking-[0.18em] text-gray-500">
              <th className="px-3 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">Name</th>
              <th className="px-3 py-2.5 font-medium">NORAD</th>
              <SortHeader
                label="Tier"
                sortKey="tier"
                current={sortKey}
                dir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Est."
                sortKey="estimatedDaysRemaining"
                current={sortKey}
                dir={sortDir}
                onSort={onSort}
              />
              <th className="px-3 py-2.5 font-medium">TIP Δ</th>
              <SortHeader
                label="Decay"
                sortKey="decayRateKmPerDay"
                current={sortKey}
                dir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Perigee"
                sortKey="perigeeKm"
                current={sortKey}
                dir={sortDir}
                onSort={onSort}
              />
              <th className="px-3 py-2.5 font-medium">Conf.</th>
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="px-3 py-2.5 font-medium">N-dot</th>
              <th className="px-3 py-2.5 font-medium">BSTAR</th>
            </tr>
            <tr>
              <th colSpan={12} className="p-0">
                <div className="h-px bg-white/5" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              pageRows.map((risk, index) => (
                <ReentryTableRow
                  key={risk.satId}
                  rank={(page - 1) * pageSize + index + 1}
                  entry={entryById.get(risk.satId)}
                  risk={risk}
                  selected={selectedSatId === risk.satId}
                  onSelect={onSelect}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={12}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  No re-entry objects match the current navigation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TablePagination
        page={page}
        pageSize={pageSize}
        totalItems={rows.length}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
      />
    </div>
  );
}
