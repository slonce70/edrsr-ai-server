import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton, SkeletonText, SkeletonList } from './Skeleton';

describe('Skeleton', () => {
  it('renders a root element with aria-hidden="true"', () => {
    const { container } = render(<Skeleton />);
    const root = container.querySelector('.skeleton');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders one skeleton bar per line for SkeletonText', () => {
    const { container } = render(<SkeletonText lines={4} />);
    expect(container.querySelectorAll('.skeleton')).toHaveLength(4);
  });

  it('renders one card per count for SkeletonList', () => {
    const { container } = render(<SkeletonList count={3} />);
    expect(container.querySelectorAll('.skeleton-card')).toHaveLength(3);
  });
});
