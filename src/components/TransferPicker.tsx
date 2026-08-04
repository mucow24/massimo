import * as Select from '@radix-ui/react-select';
import { FieldSelectContent } from './FieldSelectContent';
import { useDoc } from '../state/store';
import { stylesOfKind } from '../model/styles';
import { resolveTransferStyle } from '../model/transferStyle';
import { resolveDayNight } from '../model/dayNightColor';
import type { Transfer, TransferStyleProps } from '../model/types';

// Select sentinels. Real style ids are UUIDs (or `y0`-style counter ids in
// tests), so the dunder values can't collide with one. CUSTOM mirrors the
// StyleRow dropdown's detached label; NONE is this control's own "no transfer".
const NONE = '__none__';
const CUSTOM = '__custom__';

// Glyph box, matching LineEndGlyph so the two dropdowns share a rhythm.
const GLYPH = 15;

/**
 * The empty slot: a hollow ring where a transfer's disc would be. It has to be
 * a MARK rather than blank space, because the glyph beside it is drawn to
 * scale — and the factory transfer style is 2px, a speck an empty box would
 * pass for. (The dot picker gets away with a blank "None" precisely because no
 * dot is ever that small.)
 */
function NoTransferGlyph() {
  return (
    <svg
      width={GLYPH}
      height={GLYPH}
      viewBox={`${-GLYPH / 2} ${-GLYPH / 2} ${GLYPH} ${GLYPH}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <circle
        cx={0}
        cy={0}
        r={GLYPH / 2 - 1.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="2 2"
        opacity={0.5}
      />
    </svg>
  );
}

/**
 * A transfer style as the disc a SELF-transfer paints: the body over its halo,
 * drawn at TRUE world scale (1 unit = 1 glyph px) so the 2px factory default
 * reads as the near-invisible speck it is and a 12px one fills the box. An
 * outsized one scales down as a whole rather than clipping, so the halo:body
 * ratio still reads.
 */
export function TransferGlyph({ props }: { props: TransferStyleProps }) {
  const darkMode = useDoc((s) => s.darkMode);
  const outer = props.thickness / 2 + props.strokeWidth;
  const inner = props.thickness / 2;
  const max = GLYPH / 2;
  const k = outer > max ? max / outer : 1;
  return (
    <svg
      width={GLYPH}
      height={GLYPH}
      viewBox={`${-GLYPH / 2} ${-GLYPH / 2} ${GLYPH} ${GLYPH}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {props.strokeWidth > 0 && (
        <circle cx={0} cy={0} r={outer * k} fill={resolveDayNight(props.strokeColor, darkMode)} />
      )}
      <circle cx={0} cy={0} r={inner * k} fill={resolveDayNight(props.color, darkMode)} />
    </svg>
  );
}

/**
 * The per-stop SELF-transfer control in the station editor's stop rows: a 26px
 * glyph trigger over a dropdown of "None" plus every transfer style in the doc.
 * Picking a style wraps the stop dot in a transfer of that style; picking None
 * removes it. This is the only way in or out — see `addSelfTransfer` for why it
 * isn't just a second click on the dot.
 *
 * A transfer hand-tuned in its own popover detaches from its preset
 * (`updateTransferStyle`), so the list grows a `Custom` entry then — the same
 * sentinel the style dropdowns use. Its glyph still shows the transfer's REAL
 * resolved look, which is the honest thing for a control whose whole job is
 * telling you what's on the dot.
 */
export function StopTransferSelect({
  transfer,
  onSelect,
  ariaLabel,
}: {
  // The stop's existing self-transfer, if it has one.
  transfer: Transfer | undefined;
  // The chosen style id, or null for "None" (remove it).
  onSelect: (styleId: string | null) => void;
  ariaLabel: string;
}) {
  const styles = useDoc((s) => s.styles);
  const library = stylesOfKind(styles, 'transfer');
  // Same belt-and-braces as StyleRow: a tag that doesn't resolve to a def of
  // this kind reads as Custom.
  const tagged =
    transfer?.styleId !== undefined && styles[transfer.styleId]?.kind === 'transfer'
      ? transfer.styleId
      : undefined;
  const current = !transfer ? NONE : (tagged ?? CUSTOM);
  const resolved = transfer ? resolveTransferStyle(transfer) : undefined;

  return (
    <Select.Root
      value={current}
      onValueChange={(v) => {
        if (v === CUSTOM) return; // a state, not a choice — picking it changes nothing
        onSelect(v === NONE ? null : v);
      }}
    >
      <Select.Trigger
        className="field-select transfer-select"
        aria-label={ariaLabel}
        title={
          transfer
            ? `${ariaLabel} — a transfer disc around this stop dot`
            : `${ariaLabel} — no transfer on this stop dot`
        }
      >
        {/* Empty when there is none, exactly like a "None" stop dot: the slot
            reads as unfilled at a glance down the list. */}
        {resolved ? <TransferGlyph props={resolved} /> : <NoTransferGlyph />}
      </Select.Trigger>
      <FieldSelectContent>
        <Select.Item value={NONE} className="field-select-item">
          <span className="glyph-item">
            <NoTransferGlyph />
            <Select.ItemText>None</Select.ItemText>
          </span>
        </Select.Item>
        {current === CUSTOM && resolved && (
          <Select.Item value={CUSTOM} className="field-select-item">
            <span className="glyph-item">
              <TransferGlyph props={resolved} />
              <Select.ItemText>Custom</Select.ItemText>
            </span>
          </Select.Item>
        )}
        {library.map((def) => (
          <Select.Item key={def.id} value={def.id} className="field-select-item">
            <span className="glyph-item">
              <TransferGlyph props={def.props as TransferStyleProps} />
              <Select.ItemText>{def.name}</Select.ItemText>
            </span>
          </Select.Item>
        ))}
      </FieldSelectContent>
    </Select.Root>
  );
}
