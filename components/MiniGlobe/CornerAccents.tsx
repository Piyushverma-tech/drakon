export function CornerAccents({
  color = 'border-cyan-400',
}: {
  color?: string;
}) {
  return (
    <>
      <div
        className={`absolute top-0 left-0 w-4 h-4 border-l border-t ${color} pointer-events-none`}
      />
      <div
        className={`absolute top-0 right-0 w-4 h-4 border-r border-t ${color} pointer-events-none`}
      />
      <div
        className={`absolute bottom-0 left-0 w-4 h-4 border-l border-b ${color} pointer-events-none`}
      />
      <div
        className={`absolute bottom-0 right-0 w-4 h-4 border-r border-b ${color} pointer-events-none`}
      />
    </>
  );
}
