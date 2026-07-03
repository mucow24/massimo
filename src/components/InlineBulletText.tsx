import { Fragment } from 'react';
import type { Line } from '../model/types';
import { parseLabelLine } from '../geometry/labelTokens';
import { badgeColors } from './badge';

interface Props {
  text: string;
  /** Service-code → line lookup. Unresolved codes render as a gray "?" badge,
   *  matching the SVG `<InlineBullet>` fallback. */
  lineByService: Map<string, Line>;
}

/**
 * HTML counterpart to `<InlineBullet>`: render label text with bullet
 * tokens (`|CODE|`, `[CODE]`, `{CODE}`, doubled for unfilled) as inline
 * badges. Used in DOM contexts (sidebar station list, line-editor station
 * list) where station names sit in regular HTML rather than SVG text.
 */
export function InlineBulletText({ text, lineByService }: Props) {
  // List rows are single-line — collapse newlines so a multi-line label
  // doesn't break layout when shown in the sidebar.
  const segments = parseLabelLine(text.replace(/\n/g, ' '));
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') return <Fragment key={i}>{seg.value}</Fragment>;
        const { fill, textColor, code: display } = badgeColors(lineByService.get(seg.code));
        const className = [
          'inline-bullet-badge',
          `inline-bullet-badge--${seg.shape}`,
          seg.filled ? '' : 'inline-bullet-badge--hollow',
        ]
          .filter(Boolean)
          .join(' ');
        // Hollow badges get their interior from CSS (white/black by theme);
        // `color` carries the line color to both the outline (currentColor)
        // and the code.
        const style = seg.filled ? { background: fill, color: textColor } : { color: fill };
        return (
          <span key={i} className={className} style={style} data-inline-bullet={seg.code}>
            <span className="inline-bullet-badge__code">{display}</span>
          </span>
        );
      })}
    </>
  );
}
