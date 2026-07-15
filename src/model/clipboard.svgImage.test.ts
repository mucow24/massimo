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

  it('carries opacity through write/read, and leaves an absent one absent', () => {
    const items = readClipboard(
      writeClipboard([svgImagePayload(makeSvgImage({ id: 'i0', opacity: 0.35 }))]),
    );
    expect(items?.[0].data).toMatchObject({ opacity: 0.35 });
    const plain = readClipboard(writeClipboard([svgImagePayload(makeSvgImage({ id: 'i1' }))]));
    expect(plain?.[0].data).not.toHaveProperty('opacity');
  });

  it('rejects an href that is not an allowed image data URI (security guard)', () => {
    // An attacker-crafted clipboard string could carry a remote/script href.
    // Only inline image data URIs (svg/png/jpeg) are allowed, preserving the
    // opaque-sandbox model.
    const payload = (href: string) => ({
      format: 'massimo-clipboard',
      version: 2,
      items: [
        { kind: 'svg-image', data: { x: 0, y: 0, width: 10, height: 10, rotation: 0, href } },
      ],
    });
    expect(readClipboard(JSON.stringify(payload('http://evil.example/x')))).toBeNull();
    expect(readClipboard(JSON.stringify(payload('data:text/html;base64,AAAA')))).toBeNull();
    expect(readClipboard(JSON.stringify(payload('javascript:alert(1)')))).toBeNull();
  });

  it('accepts raster (png/jpeg) data-URI hrefs', () => {
    const payload = (href: string) => ({
      format: 'massimo-clipboard',
      version: 2,
      items: [
        { kind: 'svg-image', data: { x: 0, y: 0, width: 10, height: 10, rotation: 0, href } },
      ],
    });
    for (const href of ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,AAAA']) {
      const items = readClipboard(JSON.stringify(payload(href)));
      expect(items).not.toBeNull();
      expect(items![0].data).toMatchObject({ href });
    }
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
