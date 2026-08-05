import { TriangleDownIcon, TriangleUpIcon } from '@radix-ui/react-icons';

/** Sort direction of a clickable column header. */
export type SortDirection = 'asc' | 'desc';

/**
 * One clickable column header in a sidebar list (`.list-header`): a label that
 * sorts by its column, carrying the direction arrow while it is the active
 * one. The arrow is a Radix triangle with its own accessible name, so the sort
 * state is announced rather than shape-only — and a flipped direction ternary
 * reads "ascending" over reversed rows and fails a test.
 */
export function SortHeader({
  label,
  active,
  dir,
  className,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDirection;
  /** Extra column classes — `grow` for the title column, a width class else. */
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={'sort-header' + (className ? ' ' + className : '') + (active ? ' active' : '')}
      onClick={onClick}
    >
      {label}
      {active && (
        <span className="sort-arrow">
          {dir === 'asc' ? (
            <TriangleUpIcon role="img" aria-label="sorted ascending" width={12} height={12} />
          ) : (
            <TriangleDownIcon role="img" aria-label="sorted descending" width={12} height={12} />
          )}
        </span>
      )}
    </button>
  );
}
