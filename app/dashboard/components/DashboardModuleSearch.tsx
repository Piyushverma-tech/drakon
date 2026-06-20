'use client';

import { useModuleSearch } from '@/app/dashboard/context/DashboardSearchContext';

export function DashboardModuleSearch({
  placeholder,
}: {
  placeholder: string;
}) {
  useModuleSearch(placeholder);
  return null;
}
