import { usePopover } from './usePopover';
import { StopGlyph } from './StopGlyph';
import type { DotShape } from '../model/types';

interface ShapeOption {
  shape: DotShape;
  label: string;
}

export const SHAPES: ShapeOption[] = [
  { shape: 'filled-black', label: 'Filled black' },
  { shape: 'open-black', label: 'Open black' },
  { shape: 'filled-black-white-stroke', label: 'Filled black with white stroke' },
  { shape: 'filled-white', label: 'Filled white' },
  { shape: 'open-white', label: 'Open white' },
  { shape: 'filled-white-black-stroke', label: 'Filled white with black stroke' },
  { shape: 'filled-line-color', label: 'Filled line color' },
  { shape: 'filled-black-service-code', label: 'Filled black with service code' },
  { shape: 'filled-black-diamond', label: 'Filled black diamond' },
  { shape: 'filled-white-diamond', label: 'Filled white diamond' },
  { shape: 'none', label: 'None' },
];

const PREVIEW_SIZE = 20;
const TRIGGER_SIZE = 15;

export function StationShapePicker({
  disabled,
  currentShape,
  lineColor,
  serviceCode,
  onPick,
}: {
  disabled: boolean;
  currentShape: DotShape;
  lineColor?: string;
  serviceCode?: string;
  onPick: (shape: DotShape) => void;
}) {
  const { open, setOpen, wrapRef } = usePopover();

  const onTriggerClick = () => {
    if (disabled) return;
    setOpen((x) => !x);
  };

  const handlePick = (shape: DotShape) => {
    onPick(shape);
    setOpen(false);
  };

  return (
    <div className="shape-picker" ref={wrapRef}>
      <button
        type="button"
        className="btn-mini shape-picker-trigger"
        aria-label="Stop shape"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled}
        title={disabled ? 'Stop shape — select a stop first' : 'Stop shape'}
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
            shape={currentShape}
            lineColor={lineColor}
            serviceCode={serviceCode}
          />
        </svg>
      </button>
      {open && (
        <div className="shape-grid" role="menu">
          {SHAPES.map(({ shape, label }) => (
            <button
              key={shape}
              type="button"
              role="menuitem"
              className="shape-option"
              aria-label={label}
              onClick={() => handlePick(shape)}
            >
              <svg
                width={PREVIEW_SIZE}
                height={PREVIEW_SIZE}
                viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
              >
                <StopGlyph
                  cx={0}
                  cy={0}
                  shape={shape}
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
