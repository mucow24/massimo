import { LockClosedIcon, LockOpen1Icon } from '@radix-ui/react-icons';

interface PopoverFooterProps {
  /** Item kind, used in the lock button's aria-label (e.g. "polygon", "label"). */
  noun: string;
  /** Lock state + toggle. Omit BOTH for items without a `locked` field
   *  (transfers) — the footer then renders Delete alone. */
  locked?: boolean;
  onToggleLock?: () => void;
  onDelete: () => void;
}

/**
 * The lock-toggle + delete footer shared by every item popover (polygon, text
 * label, route bullet, svg image, transfer). Delete is disabled while locked
 * so a locked item can't be removed without first unlocking it.
 */
export function PopoverFooter({
  noun,
  locked = false,
  onToggleLock,
  onDelete,
}: PopoverFooterProps) {
  return (
    <div className="footer">
      {onToggleLock && (
        <button
          type="button"
          className={'lock-btn' + (locked ? ' active' : '')}
          aria-label={locked ? `Unlock ${noun}` : `Lock ${noun}`}
          aria-pressed={locked}
          title={locked ? 'Unlock' : 'Lock (prevents editing)'}
          onClick={onToggleLock}
        >
          {locked ? <LockClosedIcon aria-hidden="true" /> : <LockOpen1Icon aria-hidden="true" />}
          {locked ? 'Locked' : 'Lock'}
        </button>
      )}
      <button className="delete-btn" onClick={onDelete} disabled={locked}>
        Delete
      </button>
    </div>
  );
}
