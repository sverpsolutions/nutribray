import React, { useState, useRef } from 'react';
import { 
  Printer, X, Truck, Box, ShieldCheck, Download, 
  FileText, CheckCircle2, QrCode, Barcode as BarcodeIcon 
} from 'lucide-react';
import BarcodeComponent from 'react-barcode';
import { QRCodeSVG } from 'qrcode.react';
import { useBrandingStore } from '../../store/brandingStore';

interface LogisticPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  transfer: any;
  outlets: any[];
  boxes?: any[];
  items?: any[];
  dispatchInfo?: any;
  defaultTab?: 'challan' | 'labels' | 'gatepass';
}

export const LogisticPrintModal: React.FC<LogisticPrintModalProps> = ({
  isOpen,
  onClose,
  transfer,
  outlets,
  boxes: propBoxes,
  items: propItems,
  dispatchInfo: propDispatchInfo,
  defaultTab = 'challan',
}) => {
  const [activeTab, setActiveTab] = useState<'challan' | 'labels' | 'gatepass'>(defaultTab);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const { brand_name, logo_path, settings } = useBrandingStore();

  if (!isOpen || !transfer) return null;

  const legalName = settings?.legal_name || 'Nutribay';
  const brandName = brand_name || 'nutribay';
  const address = settings?.ho_address || settings?.reg_address || 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, Mathura Road, South Delhi – 110076';
  const phone = settings?.ho_phone || '74003 39365 / 82934 14222';
  const email = settings?.ho_email || '';
  const gstin = settings?.gstin || '07AAACG1234F1Z5';
  const logo = logo_path || '/nutribay_logo.svg';

  const sourceOutlet = outlets.find(o => o.id?.toString() === transfer.source_location_id?.toString());
  const destOutlet = outlets.find(o => o.id?.toString() === transfer.destination_location_id?.toString());
  const boxes = propBoxes || transfer.boxes || [];
  const items = propItems || transfer.items || [];
  const dispatch = propDispatchInfo || transfer.dispatch_details || {};

  const totalWeight = boxes.reduce((acc: number, b: any) => acc + (parseFloat(b.weight_kg) || 0), 0);
  const sealNumbers = boxes.map((b: any) => b.seal_number).filter(Boolean).join(', ') || 'N/A';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      {/* Container */}
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Modal Top Header (Screen Only) */}
        <div className="p-4 bg-slate-900 text-white flex justify-between items-center shrink-0 no-print">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#8c2785] flex items-center justify-center font-black text-white text-base">
              G
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                Logistic Documents & Print Center
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                  {transfer.transfer_number}
                </span>
              </h2>
              <p className="text-slate-400 text-xs">
                {sourceOutlet?.outlet_name || 'Source'} → {destOutlet?.outlet_name || 'Destination'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-[#8c2785] hover:bg-[#721f6d] text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition-all"
            >
              <Printer size={15} /> Print Document
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Navigation (Screen Only) */}
        <div className="bg-slate-100 border-b border-slate-200 px-6 py-2 flex items-center gap-2 shrink-0 no-print">
          <button
            onClick={() => setActiveTab('challan')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'challan'
                ? 'bg-white text-[#8c2785] shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <FileText size={15} /> Delivery Challan / Dispatch Note
          </button>
          <button
            onClick={() => setActiveTab('labels')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'labels'
                ? 'bg-white text-[#8c2785] shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Box size={15} /> Shipping & Box Labels ({boxes.length})
          </button>
          <button
            onClick={() => setActiveTab('gatepass')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'gatepass'
                ? 'bg-white text-[#8c2785] shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <ShieldCheck size={15} /> Security Gate Pass (Outward)
          </button>
        </div>

        {/* Printable Scroll Body */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 print:bg-white print:p-0" ref={printAreaRef}>
          <div id="printable-logistic-document">
            
            {/* TAB 1: DELIVERY CHALLAN & DISPATCH NOTE */}
            {activeTab === 'challan' && (
              <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-4xl mx-auto shadow-sm print:shadow-none print:border-none print:p-2 text-slate-800">
                {/* Official Letterhead */}
                <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-4">
                  <div className="flex items-start gap-4">
                    <img 
                      src={logo} 
                      alt={brandName} 
                      className="h-14 w-auto max-w-[140px] object-contain" 
                      onError={(e) => { e.currentTarget.src = '/nutribay_logo.svg'; }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-[#8c2785] text-white">
                          {brandName}
                        </span>
                        <span className="text-sm font-bold text-slate-900">{legalName}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 max-w-lg leading-tight">
                        {address}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Ph: <strong className="text-slate-700">{phone}</strong> • Email: <strong className="text-slate-700">{email}</strong> • GSTIN: <strong className="text-slate-700">{gstin}</strong>
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <h1 className="text-base font-black text-[#8c2785] uppercase tracking-tight">
                      DELIVERY CHALLAN & DISPATCH NOTE
                    </h1>
                    <p className="text-[9px] text-slate-500 italic mt-0.5">
                      (Rule 55, CGST Rules 2017 — Stock Transfer)
                    </p>
                    <div className="text-[11px] font-mono mt-2 space-y-0.5">
                      <div>Challan No: <strong className="text-slate-900 font-bold">{transfer.transfer_number}</strong></div>
                      <div>Date: <strong>{new Date(transfer.transfer_date || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div>
                      <div>Status: <span className="font-bold text-emerald-600 uppercase">{transfer.status}</span></div>
                    </div>
                  </div>
                </div>

                {/* Consignor (From) & Consignee (To) Grid */}
                <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Consignor (Dispatch Location)
                    </div>
                    <div className="font-bold text-slate-900 text-sm">{sourceOutlet?.outlet_name || 'Main Warehouse'}</div>
                    {sourceOutlet?.unit_code && <div className="text-[10px] text-slate-500 font-mono">Code: {sourceOutlet.unit_code}</div>}
                    <div className="text-slate-600 text-[11px] mt-1">{sourceOutlet?.address || address}</div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">GSTIN: {sourceOutlet?.gst_number || gstin}</div>
                  </div>

                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Consignee (Destination Location)
                    </div>
                    <div className="font-bold text-slate-900 text-sm">{destOutlet?.outlet_name || 'Destination Outlet'}</div>
                    {destOutlet?.unit_code && <div className="text-[10px] text-slate-500 font-mono">Code: {destOutlet.unit_code}</div>}
                    <div className="text-slate-600 text-[11px] mt-1">{destOutlet?.address || 'Branch Store Address'}</div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">GSTIN: {destOutlet?.gst_number || gstin}</div>
                  </div>
                </div>

                {/* Transport & Carrier Details */}
                <div className="border border-slate-200 rounded-lg p-3 mb-4 bg-slate-50/50">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Transport & Vehicle Information
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Vehicle Reg No:</span>
                      <strong className="text-slate-800 font-mono">{dispatch.vehicle_reg_no || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Driver Name:</span>
                      <strong className="text-slate-800">{dispatch.driver_name || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Driver Mobile:</span>
                      <strong className="text-slate-800 font-mono">{dispatch.driver_mobile || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Driving License:</span>
                      <strong className="text-slate-800 font-mono">{dispatch.driver_license_no || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Total Packed Boxes:</span>
                      <strong className="text-[#8c2785]">{boxes.length} Cartons</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Total Weight:</span>
                      <strong className="text-slate-800">{totalWeight > 0 ? `${totalWeight.toFixed(2)} KG` : 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Seal Numbers:</span>
                      <strong className="text-slate-800 font-mono text-[11px]">{sealNumbers}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Estimated Arrival (ETA):</span>
                      <strong className="text-slate-800 text-[11px]">
                        {dispatch.eta ? new Date(dispatch.eta).toLocaleString() : 'N/A'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Itemized Stock Manifest Table */}
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold text-[11px]">
                        <th className="p-2 text-center w-10">#</th>
                        <th className="p-2 text-left">Item Description</th>
                        <th className="p-2 text-center">Item Code</th>
                        <th className="p-2 text-center">Barcode</th>
                        <th className="p-2 text-center">HSN</th>
                        <th className="p-2 text-center">Batch / Expiry</th>
                        <th className="p-2 text-right">Qty</th>
                        <th className="p-2 text-center">Unit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150">
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-4 text-center text-slate-400 italic">
                            No items recorded on this transfer
                          </td>
                        </tr>
                      ) : (
                        items.map((it: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="p-2 text-center text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                            <td className="p-2 font-bold text-slate-900">
                              {it.name || it.product_name || `Product #${it.product_id}`}
                            </td>
                            <td className="p-2 text-center font-mono text-[10px] text-slate-600">
                              {it.item_code || '-'}
                            </td>
                            <td className="p-2 text-center font-mono text-[10px] text-slate-600">
                              {it.barcode || '-'}
                            </td>
                            <td className="p-2 text-center font-mono text-[10px] text-slate-600">
                              {it.hsn_code || '-'}
                            </td>
                            <td className="p-2 text-center text-[10px] text-slate-600">
                              {it.batch_no ? `${it.batch_no} ${it.expiry_date ? `(Exp: ${it.expiry_date})` : ''}` : '-'}
                            </td>
                            <td className="p-2 text-right font-black text-slate-900 font-mono">
                              {parseFloat(it.quantity || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                            </td>
                            <td className="p-2 text-center text-[10px] text-slate-500 uppercase">
                              {it.unit || 'PCS'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className="bg-slate-100 font-bold border-t border-slate-200 text-slate-800">
                      <tr>
                        <td colSpan={6} className="p-2 text-right text-[11px] uppercase">
                          Total Items: {items.length} Product(s) | Total Quantity:
                        </td>
                        <td className="p-2 text-right font-black font-mono text-sm text-[#8c2785]">
                          {items.reduce((acc: number, it: any) => acc + (parseFloat(it.quantity) || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                        </td>
                        <td className="p-2 text-center text-[10px] text-slate-500">Units</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Statutory Stock Transfer Declaration */}
                <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50/50 mb-6 text-[10px] text-slate-600 leading-relaxed">
                  <strong className="text-slate-800">Statutory Declaration:</strong> The goods described above are being transported for internal branch transfer / stock replenishment from our warehouse/store to branch store. This movement does not constitute a sale, and no commercial sale consideration is received. Transported under Rule 55 of CGST Rules, 2017.
                </div>

                {/* Official Signatures Blocks */}
                <div className="grid grid-cols-3 gap-6 pt-6 border-t-2 border-slate-200 text-center text-xs">
                  <div>
                    <div className="h-12 flex items-end justify-center">
                      <div className="w-36 border-b border-dashed border-slate-400"></div>
                    </div>
                    <p className="font-bold text-slate-800 mt-1">Prepared & Dispatched By</p>
                    <p className="text-[10px] text-slate-400">Warehouse In-charge / Logistics</p>
                  </div>
                  <div>
                    <div className="h-12 flex items-end justify-center">
                      <div className="w-36 border-b border-dashed border-slate-400"></div>
                    </div>
                    <p className="font-bold text-slate-800 mt-1">Transporter / Driver</p>
                    <p className="text-[10px] text-slate-400">Received Goods in Good Condition</p>
                  </div>
                  <div>
                    <div className="h-12 flex items-end justify-center">
                      <div className="w-36 border-b border-dashed border-slate-400"></div>
                    </div>
                    <p className="font-bold text-slate-800 mt-1">Receiver Store In-charge</p>
                    <p className="text-[10px] text-slate-400">Signature & Rubber Stamp</p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SHIPPING & BOX LABELS */}
            {activeTab === 'labels' && (
              <div className="space-y-6 max-w-4xl mx-auto">
                {boxes.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
                    <Box size={48} className="mx-auto mb-3 opacity-30 text-primary" />
                    <h3 className="font-bold text-slate-700 text-base">No Boxes Created Yet</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Box labels will appear here once cartons are packed in Step 3.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-1 print:gap-4">
                    {boxes.map((box: any, idx: number) => (
                      <div 
                        key={idx} 
                        className="bg-white border-2 border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between print:break-inside-avoid print:page-break-after-always print:shadow-none"
                        style={{ minHeight: '320px' }}
                      >
                        {/* Label Header */}
                        <div className="border-b-2 border-slate-800 pb-3 flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded bg-[#8c2785] text-white">
                              {brandName}
                            </span>
                            <span className="text-xs font-bold text-slate-800">SHIPPING LABEL</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Box {idx + 1} of {boxes.length}</span>
                            <span className="text-xs font-black text-slate-900 font-mono">{transfer.transfer_number}</span>
                          </div>
                        </div>

                        {/* Big Box Identifier */}
                        <div className="my-3 flex justify-between items-center bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                          <div>
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Box Number</span>
                            <h3 className="text-2xl font-black text-slate-950 tracking-tight font-mono">
                              {box.box_number}
                            </h3>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] uppercase font-bold text-slate-400 block">Weight</span>
                            <span className="text-base font-black text-[#8c2785]">
                              {box.weight_kg ? `${box.weight_kg} KG` : 'N/A'}
                            </span>
                          </div>
                        </div>

                        {/* Route Details */}
                        <div className="space-y-1.5 text-xs border-b border-slate-200 pb-3 mb-3">
                          <div className="flex justify-between items-start">
                            <span className="text-slate-400 font-bold uppercase text-[9px] w-12">FROM:</span>
                            <span className="font-bold text-slate-800 text-right flex-1 truncate">
                              {sourceOutlet?.outlet_name || 'Source Warehouse'}
                            </span>
                          </div>
                          <div className="flex justify-between items-start">
                            <span className="text-slate-400 font-bold uppercase text-[9px] w-12">TO:</span>
                            <span className="font-black text-primary text-right flex-1 truncate">
                              {destOutlet?.outlet_name || 'Destination Outlet'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-slate-400 uppercase">Seal No:</span>
                            <span className="font-bold font-mono">{box.seal_number || 'N/A'}</span>
                          </div>
                          {dispatch.vehicle_reg_no && (
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-slate-400 uppercase">Vehicle:</span>
                              <span className="font-bold font-mono">{dispatch.vehicle_reg_no} ({dispatch.driver_mobile || 'Driver'})</span>
                            </div>
                          )}
                        </div>

                        {/* Barcode & QR Code Section */}
                        <div className="flex items-center justify-between gap-4 pt-1">
                          <div className="flex-1 flex flex-col items-center justify-center">
                            <div className="scale-90 origin-center max-w-full overflow-hidden">
                              <BarcodeComponent 
                                value={box.box_number || `${transfer.transfer_number}-${idx+1}`} 
                                height={38} 
                                width={1.4}
                                fontSize={11}
                                margin={0}
                              />
                            </div>
                          </div>
                          <div className="w-20 flex flex-col items-center justify-center shrink-0 border-l border-slate-200 pl-3">
                            <QRCodeSVG 
                              value={`${transfer.transfer_number}|${box.box_number}|${destOutlet?.outlet_name || ''}`} 
                              size={60} 
                            />
                            <span className="text-[8px] text-slate-400 mt-1 uppercase font-mono">Scan Box</span>
                          </div>
                        </div>

                        {/* Small footer */}
                        <div className="mt-2 text-center text-[8px] text-slate-400 border-t border-slate-100 pt-1">
                          {legalName} • Date: {new Date().toLocaleDateString('en-IN')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: SECURITY GATE PASS (OUTWARD) */}
            {activeTab === 'gatepass' && (
              <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-3xl mx-auto shadow-sm print:shadow-none print:border-none print:p-2 text-slate-800">
                {/* Official Letterhead */}
                <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-4">
                  <div className="flex items-start gap-3">
                    <img 
                      src={logo} 
                      alt={brandName} 
                      className="h-12 w-auto max-w-[120px] object-contain" 
                      onError={(e) => { e.currentTarget.src = '/nutribay_logo.svg'; }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-[#8c2785] text-white">
                          {brandName}
                        </span>
                        <span className="text-xs font-bold text-slate-900">{legalName}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {address}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <h2 className="text-base font-black text-red-700 uppercase tracking-tight">
                      OUTWARD SECURITY GATE PASS
                    </h2>
                    <p className="text-[9px] text-slate-500 italic">Valid for Single Vehicle Exit Only</p>
                    <div className="text-[11px] font-mono mt-1 font-bold">
                      Pass No: GP-{transfer.transfer_number}
                    </div>
                  </div>
                </div>

                {/* Gate Pass Details Grid */}
                <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-1.5">
                    <div><span className="text-slate-400">Dispatch Reference:</span> <strong className="font-mono">{transfer.transfer_number}</strong></div>
                    <div><span className="text-slate-400">Date & Time:</span> <strong>{new Date().toLocaleString('en-IN')}</strong></div>
                    <div><span className="text-slate-400">From Location:</span> <strong>{sourceOutlet?.outlet_name || 'Warehouse'}</strong></div>
                    <div><span className="text-slate-400">To Destination:</span> <strong className="text-primary">{destOutlet?.outlet_name || 'Destination Store'}</strong></div>
                  </div>

                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-1.5">
                    <div><span className="text-slate-400">Vehicle Reg Number:</span> <strong className="font-mono text-slate-900 text-sm">{dispatch.vehicle_reg_no || 'N/A'}</strong></div>
                    <div><span className="text-slate-400">Driver Full Name:</span> <strong>{dispatch.driver_name || 'N/A'}</strong></div>
                    <div><span className="text-slate-400">Driver Mobile:</span> <strong className="font-mono">{dispatch.driver_mobile || 'N/A'}</strong></div>
                    <div><span className="text-slate-400">License Number:</span> <strong className="font-mono">{dispatch.driver_license_no || 'N/A'}</strong></div>
                  </div>
                </div>

                {/* Packaging and Security Check Summary */}
                <div className="border border-slate-200 rounded-lg p-4 bg-emerald-50/30 mb-6">
                  <div className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600" /> Security Verification Summary
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Total Packed Cartons:</span>
                      <strong className="text-lg font-black text-slate-900">{boxes.length} Cartons</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Total Weight:</span>
                      <strong className="text-sm font-bold text-slate-800">{totalWeight > 0 ? `${totalWeight.toFixed(2)} KG` : 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Container / Box Seals:</span>
                      <strong className="text-xs font-mono text-slate-800">{sealNumbers}</strong>
                    </div>
                  </div>
                  <div className="mt-3 text-[10px] text-slate-500 border-t border-slate-200/60 pt-2">
                    Security Instructions: Security personnel must verify vehicle registration plate, verify driver identity, count total outward carton units, and ensure seal numbers match this pass before permitting vehicle exit.
                  </div>
                </div>

                {/* Gate Signatures */}
                <div className="grid grid-cols-3 gap-6 pt-6 border-t-2 border-slate-200 text-center text-xs">
                  <div>
                    <div className="h-14 flex items-end justify-center">
                      <div className="w-32 border-b border-dashed border-slate-400"></div>
                    </div>
                    <p className="font-bold text-slate-800 mt-1">Authorized Dispatch Officer</p>
                    <p className="text-[10px] text-slate-400">Sign & Name</p>
                  </div>
                  <div>
                    <div className="h-14 flex items-end justify-center">
                      <div className="w-32 border-b border-dashed border-slate-400"></div>
                    </div>
                    <p className="font-bold text-slate-800 mt-1">Driver Acknowledgement</p>
                    <p className="text-[10px] text-slate-400">Sign & Mobile</p>
                  </div>
                  <div>
                    <div className="h-14 flex items-end justify-center">
                      <div className="w-32 border-b border-dashed border-slate-400"></div>
                    </div>
                    <p className="font-bold text-slate-800 mt-1">Main Gate Security Guard</p>
                    <p className="text-[10px] text-slate-400">Exit Time & Badge No.</p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Modal Bottom Footer (Screen Only) */}
        <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-between items-center shrink-0 no-print">
          <div className="text-xs text-slate-500">
            Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[10px]">Ctrl+P</kbd> or click Print Document to output to thermal printer or PDF.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition-colors"
            >
              Close
            </button>
            <button
              onClick={handlePrint}
              className="px-5 py-2 bg-[#8c2785] hover:bg-[#721f6d] text-white rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition-all"
            >
              <Printer size={15} /> Print {activeTab === 'challan' ? 'Delivery Challan' : activeTab === 'labels' ? 'Shipping Labels' : 'Gate Pass'}
            </button>
          </div>
        </div>

      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-logistic-document, #printable-logistic-document * {
            visibility: visible !important;
          }
          #printable-logistic-document {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 10mm !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default LogisticPrintModal;
