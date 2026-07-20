import { usePopover } from './usePopover';
import { StopGlyph } from './StopGlyph';
import { useDoc } from '../state/store';
import { stylesOfKind } from '../model/styles';
import type { DotStyle } from '../model/types';

const PREVIEW_SIZE = 20;
const TRIGGER_SIZE = 15;

/**
 * Dot-style picker: the trigger shows the current dot; the menu lists every
 * style in the doc's stopDot LIBRARY (Styles panel → "Stop dots"). Picking one
 * emits its style id — the caller stamps + tags the target slot.
 */
export function StationShapePicker({
  disabled,
  currentStyle,
  lineColor,
  serviceCode,
  onPick,
  ariaLabel = 'Stop shape',
}: {
  disabled: boolean;
  currentStyle: DotStyle;
  lineColor?: string;
  serviceCode?: string;
  onPick: (styleId: string) => void;
  // Accessible name of the trigger. Defaults to "Stop shape"; callers with
  // more than one picker on screen (the line inspector's singleton/shared
  // sections) pass distinct names so each is individually addressable.
  ariaLabel?: string;
}) {
  const { open, setOpen, wrapRef } = usePopover();
  const styles = useDoc((s) => s.styles);
  const library = stylesOfKind(styles, 'stopDot');

  const onTriggerClick = () => {
    if (disabled) return;
    setOpen((x) => !x);
  };

  const handlePick = (styleId: string) => {
    onPick(styleId);
    setOpen(false);
  };

  return (
    <div className="shape-picker" ref={wrapRef}>
      <button
        type="button"
        className="btn-mini shape-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled}
        title={disabled ? `${ariaLabel} — select a stop first` : ariaLabel}
        onClick={onTriggerClick}
      >
        <svg
          width={TRIGGER_SIZE}
          height={TRIGGER_SIZE}
          viewBox={`${-TRIGGER_SIZE / 2} ${-TRIGGER_SIZE / 2} ${TRIGGER_SIZE} ${TRIGGER_SIZE}`}
          aria-hidden="true"
        >
          <StopGlyph
            cx={0}
            cy={0}
            style={currentStyle}
            lineColor={lineColor}
            serviceCode={serviceCode}
          />
        </svg>
      </button>
      {open && (
        <div className="shape-grid" role="menu">
          {library.map((def) => (
            <button
              key={def.id}
              type="button"
              role="menuitem"
              className="shape-option"
              aria-label={def.name}
              title={def.name}
              onClick={() => handlePick(def.id)}
            >
              <svg
                width={PREVIEW_SIZE}
                height={PREVIEW_SIZE}
                viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
              >
                <StopGlyph
                  cx={0}
                  cy={0}
                  style={def.props as DotStyle}
                  lineColor={lineColor}
                  serviceCode={serviceCode}
                />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
