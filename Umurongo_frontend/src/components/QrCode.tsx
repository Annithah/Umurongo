import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { colors } from '../theme/tokens.js';

/** Renders text as a QR code image, generated in the browser (no network). */
export default function QrCode({ value, size = 160, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: colors.ink, light: colors.white } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? <img src={src} width={size} height={size} alt={label} /> : <div style={{ width: size, height: size }} aria-hidden />;
}
