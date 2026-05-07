import { useEffect, useRef, useState } from 'react';
import { useDoc, useSelection } from '../state/store';
import { STOP_DOT_RADIUS } from '../geometry/orientation';
import { StopGlyph } from './StopGlyph';
import type { DotShape } from '../model/types';

interface ShapeOption {
  shape: DotShape;
  label: string;
}

const SHAPES: ShapeOption[] = [
  { shape: 'filled-black', label: 'Filled black' },
  { shape: 'open-black', label: 'Open black' },
  { shape: 'filled-black-white-stroke', label: 'Filled black with white stroke' },
  { shape: 'filled-white', label: 'Filled white' },
  { shape: 'open-white', label: 'Open white' },
  { shape: 'filled-white-black-stroke', label: 'Filled white with black stroke' },
  { shape: 'filled-black-diamond', label: 'Filled black diamond' },
  { shape: 'filled-white-diamond', label: 'Filled white diamond' },
  { shape: 'none', label: 'None' },
];

const PREVIEW_SIZE = 20;

export function StationShapePicker() {
  const selectedStationIds = useSelection((s) => s.selectedStationIds);
  const setDotShape = useDoc((s) => s.setDotShape);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const disabled = selectedStationIds.length === 0;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onTriggerClick = () => {
    if (disabled) return;
    setOpen((x) => !x);
  };

  const onPick = (shape: DotShape) => {
    setDotShape(selectedStationIds, shape);
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
        title={disabled ? 'Stop shape — select stations first' : 'Stop shape'}
        onClick={onTriggerClick}
      >
        <TriggerIcon />
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
              onClick={() => onPick(shape)}
            >
              <svg
                width={PREVIEW_SIZE}
                height={PREVIEW_SIZE}
                viewBox={`${-PREVIEW_SIZE / 2} ${-PREVIEW_SIZE / 2} ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
              >
                <StopGlyph cx={0} cy={0} shape={shape} />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TriggerIcon() {
  return (
    <svg width={15} height={15} viewBox="-7.5 -7.5 15 15" aria-hidden="true">
      <circle cx={-2} cy={0} r={STOP_DOT_RADIUS} fill="#000" />
      <path d="M3 -1.5 L6 -1.5 L4.5 1 Z" fill="#000" />
    </svg>
  );
}
