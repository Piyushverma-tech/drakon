import UnderDevelopment from '../components/UnderDevelopment';

export default function ManueverDesignPage() {
  if (process.env.InDevelopment === 'true') {
    return <UnderDevelopment />;
  }
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1 className="text-4xl font-bold mb-4">Maneuver Design</h1>
    </div>
  );
}
