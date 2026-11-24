'use client';
import * as React from 'react';
import { CameraOff } from 'lucide-react';

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Camera scanning via the browser BarcodeDetector API (Chrome / Android / Edge).
 * USB and Bluetooth scanners don't need this — they type into the search box.
 */
export function CameraScanner({ onResult, formats = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'upc_a'] }: { onResult: (value: string) => void; formats?: string[] }) {
  const video = React.useRef<HTMLVideoElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const done = React.useRef(false);

  React.useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let last = 0;
    let stopped = false;
    async function start() {
      if (typeof window === 'undefined' || !window.BarcodeDetector) {
        setError('Camera scanning works in Chrome on Android or desktop. Use a USB scanner, or paste the code below.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        setError('Camera permission was not given. Paste the code below instead.');
        return;
      }
      if (stopped || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      const detector = new window.BarcodeDetector({ formats });
      const tick = async (t: number) => {
        if (stopped) return;
        if (t - last > 160 && video.current && video.current.readyState >= 2) {
          last = t;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue && !done.current) {
              done.current = true;
              navigator.vibrate?.(60);
              onResult(codes[0].rawValue);
              return;
            }
          } catch {
            /* frame not ready */
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult, formats]);

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-muted">
        <CameraOff className="mt-0.5 size-4 shrink-0" /> {error}
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-haldi/90" aria-hidden="true" />
    </div>
  );
}
