import { describe, it, expect } from 'vitest';
import { writeClipboard, readClipboard, svgImagePayload } from './clipboard';
import { makeSvgImage } from '../test/fixtures';

describe('svg-image clipboard', () => {
  it('round-trips an svg image through write/read', () => {
    const im = makeSvgImage({ id: 'i0', x: 5, y: 7, width: 80, height: 40, rotation: 247.5 });
    const items = readClipboard(writeClipboard([svgImagePayload(im)]));
    expect(items).not.toBeNull();
    if (!items) return;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('svg-image');
    expect(items[0].data).toMatchObject({
      x: 5,
      y: 7,
      width: 80,
      height: 40,
      rotation: 247.5,
      href: im.href,
    });
    expect('id' in items[0].data).toBe(false);
  });

  it('rejects an href that is not an svg data URI (security guard)', () => {
    // An attacker-crafted clipboard string could carry a remote/script href.
    // Only `data:image/svg+xml` is allowed, preserving the opaque-sandbox model.
    const payload = {
      format: 'massimo-clipboard',
      version: 2,
      items: [
        {
          kind: 'svg-image',
          data: { x: 0, y: 0, width: 10, height: 10, rotation: 0, href: 'http://evil.example/x' },
        },
      ],
    };
    expect(readClipboard(JSON.stringify(payload))).toBeNull();
  });

  it('rejects non-positive dimensions', () => {
    const payload = {
      format: 'massimo-clipboard',
      version: 2,
      items: [
        {
          kind: 'svg-image',
          data: {
            x: 0,
            y: 0,
            width: 0,
            height: 10,
            rotation: 0,
            href: 'data:image/svg+xml;base64,PHN2Zy8+',
          },
        },
      ],
    };
    expect(readClipboard(JSON.stringify(payload))).toBeNull();
  });
});
