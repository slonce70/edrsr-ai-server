type ProgressBarProps = {
  value?: number | null;
};

export function ProgressBar({ value }: ProgressBarProps) {
  const safe = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="progress">
      <div className="progress__fill" style={{ width: `${safe}%` }} />
    </div>
  );
}
