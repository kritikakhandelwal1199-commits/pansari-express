import QRCode from 'qrcode';
import * as S from '@pansari/shared';
import { MockPaymentProvider } from '../services/adapters/src/payment/MockPaymentProvider';
import { LocalGeoProvider } from '../services/adapters/src/geo/LocalGeoProvider';
import { MockGstProvider } from '../services/adapters/src/gst/MockGstProvider';

function qrSvg(text: string, px = 180): string {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size, quiet = 2, N = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg viewBox="0 0 ${N} ${N}" width="${px}" height="${px}" role="img" aria-label="QR code" shape-rendering="crispEdges"><rect width="${N}" height="${N}" fill="#fff"/><path d="${d}" fill="#1a0f0a"/></svg>`;
}

(window as any).PX = { ...S, qrSvg, MockPaymentProvider, LocalGeoProvider, MockGstProvider };
