/**
 * QuickScan — HHT barcode / QR scanner
 * Engine : ZXing (same library used by enterprise scanners)
 * Modes  : Live camera (Android/HTTPS) | Photo capture (iOS/HTTP)
 *           Keyboard-wedge / laser HHT (manual input auto-submit)
 * Formats: QR · Code128 · Code39 · Code93 · EAN-13/8 · UPC-A/E · ITF · DataMatrix · PDF-417 · Aztec · Codabar
 */

import React, {
  useState, useEffect, useRef, useCallback, ChangeEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader, BrowserCodeReader, IScannerControls } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat, NotFoundException } from '@zxing/library';
import HHTLayout from '../../layouts/HHTLayout';
import api from '../../api/axios';

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'SCAN_RACK' | 'SCAN_ITEM';

interface RackInfo {
  id: number; rack_code: string; aisle_code: string; division_code: string;
  rack_number: string; shelf_level: string | null; bin_code: string | null;
  current_qty: number; capacity: number | null;
}
interface ItemInfo {
  id: number; name: string; item_code: string; barcode: string | null; unit: string | null;
}

// ── ZXing scanner hints — ALL formats + TRY_HARDER ───────────────────────────

const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.AZTEC,
    BarcodeFormat.PDF_417,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ]],
]);

// ── Device detection ──────────────────────────────────────────────────────────

// Live camera needs secure context (HTTPS or localhost) — iOS Safari always requires it
const canLiveScan = () =>
  !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

// ── Image → Canvas — fixes iOS EXIF rotation, returns canvas for ZXing ───────
// Drawing via <img> tag makes the browser apply EXIF orientation automatically.
// We decode from the canvas directly so ZXing reads pixel data without a
// second round-trip through HTMLImageElement.

const fileToCanvas = (file: File): Promise<HTMLCanvasElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 2048;
      const scale = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 1);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });

// ── LIVE SCANNER (Android / HTTPS) ───────────────────────────────────────────

interface ScannerProps { onScan(v: string): void; onClose(): void; label: string; }

const LiveScanner: React.FC<ScannerProps> = ({ onScan, onClose, label }) => {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const ctrlRef   = useRef<IScannerControls | null>(null);
  const scanned   = useRef(false);
  const mounted   = useRef(true);

  const [status,   setStatus]   = useState<'init'|'ready'|'err'>('init');
  const [errMsg,   setErrMsg]   = useState('');
  const [torch,    setTorch]    = useState(false);
  const [torchOK,  setTorchOK]  = useState(false);
  const [cameras,  setCameras]  = useState<MediaDeviceInfo[]>([]);
  const [camIdx,   setCamIdx]   = useState(0);

  const stop = useCallback(() => { ctrlRef.current?.stop(); }, []);

  const startScan = useCallback(async (deviceId?: string) => {
    if (!videoRef.current) return;
    stop();
    scanned.current = false;
    setStatus('init');

    try {
      // Build stream with optimal constraints for barcode scanning
      const constraints: MediaStreamConstraints = {
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
          width:  { ideal: 1280, min: 640 },
          height: { ideal: 720,  min: 480 },
          // Advanced constraints — continuous autofocus
          advanced: [{ focusMode: 'continuous' } as any],
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!mounted.current) { stream.getTracks().forEach(t => t.stop()); return; }

      // Check torch support
      const track = stream.getVideoTracks()[0];
      const cap = track.getCapabilities?.() as any;
      setTorchOK(!!cap?.torch);

      const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 80 });

      const ctrl = await reader.decodeFromStream(stream, videoRef.current,
        (result, err) => {
          if (!mounted.current || scanned.current) return;
          if (result) {
            scanned.current = true;
            if (navigator.vibrate) navigator.vibrate(120);
            ctrl.stop();
            onScan(result.getText());
            return;
          }
          // NotFoundException is normal (no barcode in frame) — ignore
          if (err && !(err instanceof NotFoundException)) {
            console.warn('ZXing decode error:', err.message);
          }
        },
      );

      ctrlRef.current = ctrl;
      if (mounted.current) setStatus('ready');

      // Enumerate cameras after stream starts (browser unlocks labels after permission)
      const devs = await BrowserCodeReader.listVideoInputDevices().catch(() => []);
      if (mounted.current) setCameras(devs);

    } catch (e: any) {
      if (!mounted.current) return;
      setStatus('err');
      setErrMsg(
        e.name === 'NotAllowedError'  ? 'Camera permission denied.\nOpen browser Settings → allow camera for this site.' :
        e.name === 'NotFoundError'    ? 'No camera found on this device.' :
        e.name === 'NotReadableError' ? 'Camera is busy. Close other camera apps and retry.' :
                                        `Camera error: ${e.message}`,
      );
    }
  }, [onScan, stop]);

  useEffect(() => {
    mounted.current = true;
    startScan();
    return () => { mounted.current = false; stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const next = (camIdx + 1) % cameras.length;
    setCamIdx(next);
    await startScan(cameras[next].deviceId);
  };

  const toggleTorch = async () => {
    const track = (videoRef.current?.srcObject as MediaStream)?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torch;
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorch(next);
    } catch { /* torch not supported */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" style={{ touchAction: 'none' }}>

      {/* Header */}
      <div className="flex-shrink-0 bg-blue-800 flex items-center gap-2 px-3 py-2"
           style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button onClick={() => { stop(); onClose(); }}
          className="w-10 h-10 rounded-full bg-white/20 text-white font-black text-xl flex items-center justify-center flex-shrink-0">
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-black text-sm uppercase tracking-wider">📷 Live Scanner</p>
          <p className="text-blue-200 text-[10px] truncate">{label}</p>
        </div>
        {torchOK && (
          <button onClick={toggleTorch}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${torch ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}>
            🔦
          </button>
        )}
        {cameras.length > 1 && (
          <button onClick={switchCamera}
            className="w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center text-lg flex-shrink-0">
            🔄
          </button>
        )}
      </div>

      {/* Camera view */}
      <div className="flex-1 relative bg-black overflow-hidden">

        {/* Loading */}
        {status === 'init' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
            <div className="w-14 h-14 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-white font-bold">Starting camera…</p>
            <p className="text-slate-400 text-xs mt-1">Tap Allow if asked for camera permission</p>
          </div>
        )}

        {/* Error */}
        {status === 'err' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center z-20">
            <p className="text-5xl mb-4">🚫</p>
            <p className="text-red-400 font-bold text-sm whitespace-pre-line mb-6">{errMsg}</p>
            <button onClick={() => startScan()}
              className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black mb-3 active:scale-95">
              Retry
            </button>
            <button onClick={() => { stop(); onClose(); }}
              className="text-slate-400 text-sm font-bold">
              Use manual input
            </button>
          </div>
        )}

        {/* Video */}
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover"
          playsInline muted autoPlay
          style={{ display: status === 'ready' ? 'block' : 'none' }} />

        {/* Scan overlay */}
        {status === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {/* Dark mask around scan box */}
            <div className="relative" style={{ width: 280, height: 180 }}>
              <div className="absolute inset-0"
                style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.58)', borderRadius: 12 }} />
              <div className="absolute inset-0 border-2 border-yellow-400 rounded-xl" />
              {/* Corner marks */}
              {[
                'top-0 left-0 border-t-4 border-l-4 rounded-tl-xl',
                'top-0 right-0 border-t-4 border-r-4 rounded-tr-xl',
                'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl',
                'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl',
              ].map(c => (
                <div key={c} className={`absolute w-8 h-8 border-yellow-400 ${c}`} />
              ))}
              {/* Animated scan line */}
              <div className="absolute inset-x-3 h-0.5 bg-red-500"
                style={{ animation: 'scanline 1.8s ease-in-out infinite', top: '50%' }} />
            </div>
            <p className="text-yellow-300 text-xs font-bold mt-4 uppercase tracking-widest">
              Align barcode · hold steady
            </p>
            <p className="text-white/50 text-[10px] mt-1">Supports QR · 1D · 2D barcodes</p>
          </div>
        )}
      </div>

      {/* Footer */}
      {status === 'ready' && (
        <div className="flex-shrink-0 bg-gray-900 py-3 text-center"
             style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <p className="text-gray-300 text-xs font-semibold">Scanning automatically — no button needed</p>
        </div>
      )}

      <style>{`
        @keyframes scanline {
          0%   { transform: translateY(-70px); opacity: 0.9; }
          50%  { transform: translateY(0px);   opacity: 1;   }
          100% { transform: translateY(70px);  opacity: 0.9; }
        }
      `}</style>
    </div>
  );
};

// ── PHOTO SCANNER (iOS / HTTP — capture one photo → ZXing decode) ─────────────

const PhotoScanner: React.FC<ScannerProps> = ({ onScan, onClose, label }) => {
  const fileRef   = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const handleCapture = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setError(null);

    try {
      // 1. Convert file → canvas (fixes EXIF rotation, downscales)
      const canvas = await fileToCanvas(file);

      // 2. Decode pixel data directly — more reliable than decodeFromImageElement
      const reader = new BrowserMultiFormatReader(HINTS);
      const result = await (reader as any).decodeFromCanvas(canvas);

      if (navigator.vibrate) navigator.vibrate(120);
      onScan(result.getText());

    } catch (err: any) {
      const n = attempts + 1;
      setAttempts(n);
      setError(
        n === 1 ? 'Not detected — fill the frame with the barcode and tap again.' :
        n === 2 ? 'Still failing — move closer, improve lighting, hold phone steady.' :
                  'Cannot read. Type the code manually below.',
      );
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col" style={{ touchAction: 'none' }}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        className="hidden" onChange={handleCapture} />

      {/* Header */}
      <div className="flex-shrink-0 bg-blue-800 flex items-center gap-2 px-3 py-2"
           style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/20 text-white font-black text-xl flex items-center justify-center">
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-white font-black text-sm uppercase tracking-wider">📷 Barcode Scanner</p>
          <p className="text-blue-200 text-[10px] truncate">{label}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center overflow-y-auto py-4">
        {scanning ? (
          <>
            <div className="w-20 h-20 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mb-5" />
            <p className="text-white font-black text-xl">Reading barcode…</p>
            <p className="text-slate-400 text-sm mt-2">ZXing decoding your photo</p>
          </>
        ) : (
          <>
            <div className="w-28 h-28 bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl flex items-center justify-center text-5xl mb-5 shadow-2xl">
              📷
            </div>
            <p className="text-white font-black text-2xl mb-1">Shoot Barcode</p>
            <p className="text-blue-300 text-[11px] mb-4 uppercase tracking-widest">
              QR · Code128 · EAN-13 · UPC · Code39 · and more
            </p>

            <div className="bg-white/8 border border-white/15 rounded-2xl px-4 py-4 mb-5 text-left w-full max-w-xs">
              {[
                '① Tap "Open Camera"',
                '② Point at the barcode — fill the frame',
                '③ Wait for iPhone to focus (tap screen if needed)',
                '④ Tap the shutter button (white circle)',
                '⑤ App reads it automatically',
              ].map(t => (
                <p key={t} className="text-slate-300 text-sm py-1 flex items-start gap-2">
                  <span className="text-blue-400 flex-shrink-0 leading-5">›</span>{t}
                </p>
              ))}
            </div>

            {error && (
              <div className="bg-red-900/60 border border-red-500 text-red-300 rounded-xl px-4 py-3 mb-4 text-sm w-full max-w-xs text-left">
                ⚠️ {error}
              </div>
            )}

            <button onClick={() => fileRef.current?.click()}
              className="w-full max-w-xs bg-blue-600 hover:bg-blue-500 text-white font-black text-lg uppercase tracking-widest py-5 rounded-3xl shadow-xl active:scale-95 transition-all">
              📸 {attempts > 0 ? 'Try Again' : 'Open Camera'}
            </button>
          </>
        )}
      </div>

      <div className="flex-shrink-0 px-6 py-4 text-center"
           style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <button onClick={onClose} className="text-slate-500 text-sm font-bold">
          ← Back · use manual input
        </button>
      </div>
    </div>
  );
};

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

const QuickScan: React.FC = () => {
  const navigate   = useNavigate();
  const inputRef   = useRef<HTMLInputElement>(null);
  const wedgeTimer = useRef<ReturnType<typeof setTimeout>>();

  const [step,       setStep]       = useState<Step>('SCAN_RACK');
  const [inputVal,   setInputVal]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [rack,       setRack]       = useState<RackInfo | null>(null);
  const [item,       setItem]       = useState<ItemInfo | null>(null);

  const liveMode = canLiveScan();

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 150); }, [step]);

  // ── Keyboard-wedge / laser HHT: auto-submit after 120 ms silence ──────────
  const handleInputChange = (v: string) => {
    setInputVal(v);
    clearTimeout(wedgeTimer.current);
    // If value arrives in <80 ms bursts (scanner behavior) auto-submit
    wedgeTimer.current = setTimeout(() => {
      if (v.trim().length >= 4) submitValue(v.trim());
    }, 120);
  };

  const vibrate = (ok: boolean) => {
    if (navigator.vibrate) navigator.vibrate(ok ? [80] : [80, 60, 80]);
  };

  const submitValue = useCallback(async (val: string) => {
    if (!val || loading) return;
    clearTimeout(wedgeTimer.current);
    setInputVal('');
    setLoading(true);
    setError(null);
    try {
      if (step === 'SCAN_RACK') {
        const res = await api.get(`/wms/rack-info/${encodeURIComponent(val)}`);
        setRack(res.data);
        setItem(null);
        setStep('SCAN_ITEM');
        vibrate(true);
      } else {
        const res = await api.get(`/products/search?q=${encodeURIComponent(val)}`);
        if (res.data?.length > 0) { setItem(res.data[0]); vibrate(true); }
        else { setError(`Item "${val}" not found.`); vibrate(false); }
      }
    } catch {
      setError(
        step === 'SCAN_RACK'
          ? `Rack "${val}" not found — check label or type manually.`
          : `Item "${val}" not found.`,
      );
      vibrate(false);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCameraResult = (val: string) => { setShowCamera(false); submitValue(val.trim()); };
  const reset = () => { setStep('SCAN_RACK'); setRack(null); setItem(null); setError(null); setInputVal(''); };

  const fillPct = (qty: number, cap: number | null) =>
    cap && cap > 0 ? Math.min(Math.round((qty / cap) * 100), 100) : 0;

  const scanLabel = step === 'SCAN_RACK'
    ? 'Point at rack QR code or barcode'
    : `Scan item barcode — Rack: ${rack?.rack_code}`;

  return (
    <>
      {showCamera && (
        liveMode
          ? <LiveScanner  onScan={handleCameraResult} onClose={() => setShowCamera(false)} label={scanLabel} />
          : <PhotoScanner onScan={handleCameraResult} onClose={() => setShowCamera(false)} label={scanLabel} />
      )}

      <HHTLayout title="Quick Scan" onBack={() => navigate('/hht')}>

        {/* Step indicator */}
        <div className="flex gap-2 mb-4">
          {(['SCAN_RACK', 'SCAN_ITEM'] as Step[]).map((s, i) => (
            <div key={s} className={`flex items-center gap-2 flex-1 rounded-xl px-3 py-2.5 text-xs font-black uppercase tracking-widest transition-all ${step === s ? 'bg-blue-600 text-white shadow' : rack && i === 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${step === s ? 'bg-white text-blue-600' : rack && i === 0 ? 'bg-green-500 text-white' : 'bg-slate-300 text-slate-500'}`}>
                {rack && i === 0 ? '✓' : i + 1}
              </span>
              {s === 'SCAN_RACK' ? 'Scan Rack' : 'Scan Item'}
            </div>
          ))}
        </div>

        {/* Mode badge */}
        <div className="flex justify-center mb-3">
          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${liveMode ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
            {liveMode ? '📷 Live scan · auto-detect' : '📸 iPhone · photo decode'}
          </span>
        </div>

        {/* Big scan button */}
        <button
          onClick={() => setShowCamera(true)}
          disabled={loading}
          className={`w-full rounded-3xl py-7 mb-4 flex flex-col items-center gap-2 font-black text-white shadow-xl active:scale-95 transition-all disabled:opacity-50 ${step === 'SCAN_RACK' ? 'bg-gradient-to-br from-orange-500 to-orange-600' : 'bg-gradient-to-br from-blue-600 to-blue-700'}`}
        >
          <span className="text-5xl">{liveMode ? '📷' : '📸'}</span>
          <span className="text-xl uppercase tracking-widest">
            {step === 'SCAN_RACK' ? 'Scan Rack' : 'Scan Item'}
          </span>
          <span className="text-xs font-medium opacity-75 normal-case px-4 text-center">
            {step === 'SCAN_RACK'
              ? 'QR code · barcode · rack label'
              : `Item barcode → rack ${rack?.rack_code}`}
          </span>
        </button>

        {/* Manual / keyboard-wedge input */}
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
          Manual / laser scanner input
        </p>
        <div className="flex gap-2 mb-1">
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { clearTimeout(wedgeTimer.current); submitValue(inputVal.trim()); } }}
            placeholder={step === 'SCAN_RACK' ? 'Rack code / scan laser here…' : 'Item barcode / scan laser here…'}
            className="flex-1 border-2 border-slate-300 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-blue-500 bg-white shadow-sm"
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            inputMode="none"
          />
          <button
            onClick={() => { clearTimeout(wedgeTimer.current); submitValue(inputVal.trim()); }}
            disabled={loading || !inputVal.trim()}
            className="px-5 py-3 bg-blue-600 active:scale-95 text-white rounded-xl font-black uppercase disabled:opacity-40 shadow min-w-[60px] text-sm"
          >
            {loading ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'GO'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border-2 border-red-300 text-red-700 rounded-xl px-4 py-3 mt-3 flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 mt-0.5">⚠️</span>
              <span className="text-sm font-bold">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 text-xl font-bold flex-shrink-0">×</button>
          </div>
        )}

        {/* Rack card */}
        {rack && (
          <div className={`rounded-2xl border-2 overflow-hidden mt-4 shadow-sm ${item ? 'border-green-400' : 'border-blue-400'}`}>
            <div className={`px-4 py-2.5 flex items-center justify-between ${item ? 'bg-green-500' : 'bg-blue-600'}`}>
              <div className="flex items-center gap-2">
                <span className="text-white">📦</span>
                <span className="text-white text-xs font-black uppercase tracking-widest">Rack Confirmed</span>
              </div>
              <button onClick={reset} className="text-white/70 text-xs font-bold">Change ×</button>
            </div>
            <div className="bg-white p-4">
              <p className="text-2xl font-black text-slate-800 mb-0.5">{rack.rack_code}</p>
              <p className="text-xs text-slate-500 mb-3">
                {rack.aisle_code} → {rack.division_code}
                {rack.shelf_level ? ` → ${rack.shelf_level}` : ''}
                {rack.bin_code    ? ` · Bin: ${rack.bin_code}` : ''}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Current Qty</p>
                  <p className="text-2xl font-black text-blue-600">{rack.current_qty}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Capacity</p>
                  <p className="text-2xl font-black text-slate-700">{rack.capacity ?? '—'}</p>
                </div>
              </div>
              {rack.capacity != null && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>Fill</span><span>{fillPct(rack.current_qty, rack.capacity)}%</span>
                  </div>
                  <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div className={`h-full rounded-full ${fillPct(rack.current_qty, rack.capacity) >= 80 ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ width: `${fillPct(rack.current_qty, rack.capacity)}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Item card */}
        {item && rack && (
          <div className="rounded-2xl border-2 border-green-400 overflow-hidden mt-4 shadow-sm">
            <div className="bg-green-500 px-4 py-2.5 flex items-center gap-2">
              <span className="text-white">🏷️</span>
              <span className="text-white text-xs font-black uppercase tracking-widest">Item Found</span>
            </div>
            <div className="bg-white p-4">
              <p className="text-lg font-black text-slate-800 mb-0.5 leading-tight">{item.name}</p>
              <p className="text-xs text-slate-500 mb-3">
                Code: <span className="font-bold text-slate-700">{item.item_code}</span>
                {item.unit ? ` · ${item.unit}` : ''}
              </p>
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <p className="text-sm font-black text-green-800">Ready for Putaway</p>
                  <p className="text-xs text-green-600">{item.name} → {rack.rack_code}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/hht/putaway/manual?barcode=${item.barcode || item.item_code}&rack=${rack.rack_code}`)}
                  className="flex-1 bg-blue-600 text-white font-black text-sm uppercase tracking-widest py-3 rounded-xl active:scale-95">
                  🏭 Do Putaway
                </button>
                <button
                  onClick={() => { setItem(null); setStep('SCAN_ITEM'); setError(null); }}
                  className="px-4 py-3 border-2 border-slate-300 text-slate-600 rounded-xl font-black text-xs uppercase active:scale-95">
                  Rescan
                </button>
              </div>
            </div>
          </div>
        )}

        {(rack || error) && (
          <button onClick={reset}
            className="w-full flex items-center justify-center gap-2 py-3 text-slate-400 text-sm font-bold mt-3">
            🔄 Start Over / New Rack
          </button>
        )}

      </HHTLayout>
    </>
  );
};

export default QuickScan;
