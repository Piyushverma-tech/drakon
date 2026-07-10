import { notFound } from 'next/navigation';
import { ReentryAnalysisPage } from './components/ReentryAnalysisPage';

export default async function ReentryAnalysisRoute({
  params,
}: {
  params: Promise<{ noradId: string }>;
}) {
  const { noradId: noradIdParam } = await params;
  const noradId = Number(noradIdParam);

  if (!Number.isInteger(noradId) || noradId <= 0) {
    notFound();
  }

  return <ReentryAnalysisPage noradId={noradId} />;
}
