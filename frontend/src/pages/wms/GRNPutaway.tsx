import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import HHTLayout from '../../layouts/HHTLayout';
import api from '../../api/axios';

type FlowState = 'SCAN_RACK' | 'SCAN_ITEM' | 'ENTER_QTY' | 'SUCCESS';

const GRNPutaway: React.FC = () => {
  const { grnId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<FlowState>('SCAN_RACK');
  const [rackCode, setRackCode] = useState('');
  const [itemBarcode, setItemBarcode] = useState('');
  const [qty, setQty] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentGRN, setCurrentGRN] = useState<any>(null);
  const [currentItem, setCurrentItem] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchGRNDetails();
    setTimeout(() => inputRef.current?.focus(), 500);
  }, []);

  const fetchGRNDetails = async () => {
    try {
      const res = await api.get(`/wms/grn-details/${grnId}`);
      setCurrentGRN(res.data);
    } catch (err) {
      console.error('Error fetching GRN details', err);
    }
  };

  const playSound = (type: 'success' | 'error') => {
    const audio = document.getElementById(type === 'success' ? 'beep-success' : 'beep-error') as HTMLAudioElement;
    if (audio) audio.play().catch(() => {});
    if (navigator.vibrate) navigator.vibrate(type === 'success' ? 100 : [100, 50, 100]);
  };

  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    setError(null);
    if (state === 'SCAN_RACK') {
      try {
        await api.get(`/wms/rack-info/${value}`);
        setRackCode(value);
        setState('SCAN_ITEM');
        playSound('success');
      } catch {
        setError('Invalid Rack Barcode!');
        playSound('error');
      }
    } else if (state === 'SCAN_ITEM') {
      const item = currentGRN?.find((i: any) => i.barcode === value || i.item_code === value);
      if (item) {
        setItemBarcode(value);
        setCurrentItem(item);
        setQty('1');
        setState('ENTER_QTY');
        playSound('success');
      } else {
        setError('Item not found in this GRN!');
        playSound('error');
      }
    }
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.focus();
  };

  const submitPutaway = async () => {
    setLoading(true);
    try {
      await api.post('/wms/putaway', {
        grn_id: grnId,
        rack_code: rackCode,
        barcode: itemBarcode,
        qty: parseFloat(qty),
      });
      setState('SUCCESS');
      playSound('success');
      setTimeout(() => {
        setState('SCAN_ITEM');
        setItemBarcode('');
        setQty('0');
        setCurrentItem(null);
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save putaway');
      playSound('error');
    } finally {
      setLoading(false);
    }
  };

  const handleKeypad = (val: string) => {
    if (val === 'back') {
      setQty(prev => (prev.length > 1 ? prev.slice(0, -1) : '0'));
    } else if (val === '.') {
      if (!qty.includes('.')) setQty(prev => prev + '.');
    } else {
      setQty(prev => (prev === '0' ? val : prev + val));
    }
  };

  const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

  return (
    <HHTLayout title={`Putaway: ${grnId}`} onBack={() => navigate('/hht')}>

      {/* Hidden scanner input */}
      <input
        ref={inputRef}
        type="text"
        className="absolute opacity-0 h-0 w-0 pointer-events-none"
        onKeyDown={e => { if (e.key === 'Enter') handleScan((e.target as HTMLInputElement).value); }}
        autoFocus
      />

      {/* Rack indicator */}
      <div className={`rounded-2xl p-3 mb-3 flex items-center gap-3 ${rackCode ? 'bg-green-700' : 'bg-slate-700'} text-white shadow`}>
        <i className="fas fa-map-marker-alt text-xl"></i>
        <div className="flex-1">
          <p className="text-[9px] font-black uppercase tracking-widest opacity-70">Current Rack</p>
          <p className="text-lg font-black">{rackCode || 'SCAN RACK BARCODE...'}</p>
        </div>
        {rackCode && (
          <button
            onClick={() => { setRackCode(''); setState('SCAN_RACK'); }}
            className="text-[10px] font-black uppercase bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors"
          >
            CHANGE
          </button>
        )}
      </div>

      {/* Error alert */}
      {error && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-3 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <i className="fas fa-exclamation-circle"></i>
            <span className="text-sm font-bold">{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}

      {/* Main flow content */}
      <div className="flex-1 flex flex-col justify-center">

        {/* SCAN_RACK */}
        {state === 'SCAN_RACK' && (
          <div className="text-center py-8">
            <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-4 text-5xl">
              <i className="fas fa-qrcode"></i>
            </div>
            <p className="text-2xl font-black text-slate-800">SCAN RACK</p>
            <p className="text-slate-500 text-sm mt-1">Point laser at the rack label</p>
          </div>
        )}

        {/* SCAN_ITEM */}
        {state === 'SCAN_ITEM' && (
          <div className="text-center py-8">
            <div className="w-24 h-24 bg-purple-100 text-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-4 text-5xl">
              <i className="fas fa-barcode"></i>
            </div>
            <p className="text-2xl font-black text-slate-800">SCAN ITEM</p>
            <p className="text-slate-500 text-sm mt-1">Scan the product barcode</p>
          </div>
        )}

        {/* ENTER_QTY / SUCCESS */}
        {(state === 'ENTER_QTY' || state === 'SUCCESS') && (
          <div className="space-y-3">
            {/* Item card */}
            <div className="bg-white border-2 border-blue-500 rounded-2xl p-4">
              <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Item Detected</p>
              <p className="text-base font-black text-slate-800 mt-1">{currentItem?.item_name}</p>
              <p className="text-xs text-slate-500">{currentItem?.item_code}</p>
              <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between text-xs font-bold text-slate-600">
                <span>Pending: <span className="text-slate-900">{currentItem?.qty_total}</span></span>
                <span>Placed: <span className="text-slate-900">{currentItem?.qty_placed}</span></span>
              </div>
            </div>

            {state === 'SUCCESS' ? (
              <div className="text-center py-6">
                <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3 text-5xl">
                  <i className="fas fa-check-circle"></i>
                </div>
                <p className="text-2xl font-black text-green-600">SAVED!</p>
              </div>
            ) : (
              <>
                {/* Quantity display */}
                <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Quantity to Place</p>
                  <p className="text-5xl font-black text-slate-800 tabular-nums">{qty}</p>
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2">
                  {KEYPAD.map(key => (
                    <button
                      key={key}
                      onClick={() => handleKeypad(key)}
                      className="h-14 rounded-xl border border-slate-200 bg-white text-slate-800 text-2xl font-black shadow-sm hover:bg-blue-50 active:scale-95 transition-all flex items-center justify-center"
                    >
                      {key === 'back'
                        ? <i className="fas fa-backspace text-lg text-red-400"></i>
                        : key}
                    </button>
                  ))}
                </div>

                {/* Submit */}
                <button
                  onClick={submitPutaway}
                  disabled={loading || parseFloat(qty) <= 0}
                  className="w-full h-16 bg-blue-600 hover:bg-blue-700 text-white font-black text-xl uppercase tracking-widest rounded-2xl shadow-lg flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50"
                >
                  {loading
                    ? <><i className="fas fa-circle-notch fa-spin"></i> Saving...</>
                    : <><i className="fas fa-plus-circle"></i> ADD TO RACK</>}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Manual input button (floating) */}
      <button
        onClick={() => {
          const val = prompt('Enter barcode manually:');
          if (val) handleScan(val);
        }}
        className="fixed bottom-5 right-5 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-95 z-50"
      >
        <i className="fas fa-keyboard text-xl"></i>
      </button>

    </HHTLayout>
  );
};

export default GRNPutaway;
