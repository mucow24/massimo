import { Fragment, useId } from 'react';
import { EyeOpenIcon } from '@radix-ui/react-icons';
import { usePopover } from './usePopover';
import { FieldCheckbox } from './FieldCheckbox';
import { useViewportStore } from '../state/viewportStore';
import {
  anyLayerHidden,
  setVisibility,
  VISIBILITY_ITEMS,
  type VisibilityKey,
} from '../state/visibility';

/**
 * Toolbar "View" button: which layers the canvas paints. Replaced three
 * standalone toolbar toggles (waypoints, anchors, lines+stations) — the set only
 * grows, and nine buttons in a row is not a toolbar.
 *
 * The button carries a mark whenever a layer the canvas would normally paint is
 * switched off (see anyLayerHidden). Without it the state is a click away from
 * being invisible, and "where did my polygons go" has no answer on screen — the
 * very reason `showNetwork` refuses to persist.
 *
 * The grid deliberately keeps its own button: it is a drawing aid rather than
 * map content, and it pairs with the grid-size cycler beside it.
 */
export function ViewPopover() {
  const { open, setOpen, wrapRef } = usePopover();
  const panelId = useId();

  // One subscription per flag rather than a whole-store read: the store also
  // holds the camera, which writes on every pan and zoom frame. The
  // `Record<VisibilityKey, …>` annotation is what keeps this honest — adding a
  // flag to the registry without adding it here is a type error, not a menu
  // row that silently goes missing.
  const values: Record<VisibilityKey, boolean> = {
    showNetwork: useViewportStore((s) => s.showNetwork),
    showAnchors: useViewportStore((s) => s.showAnchors),
    showLineCircles: useViewportStore((s) => s.showLineCircles),
    showTransfers: useViewportStore((s) => s.showTransfers),
    showWaypoints: useViewportStore((s) => s.showWaypoints),
    showSvgImages: useViewportStore((s) => s.showSvgImages),
    showTextLabels: useViewportStore((s) => s.showTextLabels),
    showPolygons: useViewportStore((s) => s.showPolygons),
    showRouteBullets: useViewportStore((s) => s.showRouteBullets),
  };
  const marked = anyLayerHidden(values);

  return (
    <div className="view-popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'tool-btn' + (open ? ' active' : '') + (marked ? ' has-hidden' : '')}
        title={marked ? 'View — some layers are hidden' : 'View'}
        aria-label="View"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <EyeOpenIcon />
      </button>
      {open && (
        <div className="view-popover" id={panelId} role="dialog" aria-label="View">
          {VISIBILITY_ITEMS.map((item, i) => {
            const prev = i > 0 ? VISIBILITY_ITEMS[i - 1] : null;
            return (
              <Fragment key={item.key}>
                {prev !== null && prev.group !== item.group && (
                  <hr className="view-popover-divider" aria-hidden="true" />
                )}
                <label className="view-popover-row">
                  <FieldCheckbox
                    ariaLabel={item.label}
                    checked={values[item.key]}
                    onCheckedChange={(checked) => setVisibility(item.key, checked)}
                  />
                  <span>{item.label}</span>
                </label>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
