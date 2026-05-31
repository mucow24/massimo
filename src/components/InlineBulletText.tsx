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
 * HTML counterpart to `<InlineBullet>`: render label text with `<CODE>`
 * bullet tokens as inline circular badges. Used in DOM contexts (sidebar
 * station list, line-editor station list) where station names sit in
 * regular HTML rather than SVG text.
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
        return (
          <span
            key={i}
            className="inline-bullet-badge"
            style={{ background: fill, color: textColor }}
            data-inline-bullet={seg.code}
          >
            <span className="inline-bullet-badge__code">{display}</span>
          </span>
        );
      })}
    </>
  );
}
