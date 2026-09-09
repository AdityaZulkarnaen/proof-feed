/**
 * Apple touch icon. iOS will not render an SVG favicon, so the same mark is rasterised at build
 * time. Drawn with the literal palette values rather than the CSS variables, because this renders
 * outside the document.
 */
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#14110e',
        }}
      >
        <svg width="180" height="180" viewBox="0 0 20 20" fill="none">
          <path d="M3 6h7" stroke="#f2ede1" strokeWidth="2.6" strokeLinecap="square" />
          <path d="M10 6v8" stroke="#d9a441" strokeWidth="2.6" />
          <path d="M10 14h7" stroke="#f2ede1" strokeWidth="2.6" strokeLinecap="square" />
        </svg>
      </div>
    ),
    size,
  );
}
