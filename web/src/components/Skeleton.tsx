type SkeletonProps = {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
};

export function Skeleton({ width = '100%', height = '1rem', radius = '6px', className }: SkeletonProps) {
  return (
    <span
      className={'skeleton' + (className ? ' ' + className : '')}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

type SkeletonTextProps = {
  lines?: number;
};

export function SkeletonText({ lines = 3 }: SkeletonTextProps) {
  return (
    <div className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <Skeleton width="40%" height="1.1rem" />
      <Skeleton width="25%" height="0.75rem" />
      <Skeleton width="100%" height="0.5rem" />
    </div>
  );
}

type SkeletonListProps = {
  count?: number;
};

export function SkeletonList({ count = 5 }: SkeletonListProps) {
  return (
    <div className="list" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
