import React from 'react';
import { useBrandingStore } from '../../store/brandingStore';

interface CompanyReportHeaderProps {
  title: string;
  subtitle?: string;
  metaItems?: { label: string; value: string | number | undefined | null }[];
  printOnly?: boolean;
}

export const CompanyReportHeader: React.FC<CompanyReportHeaderProps> = ({
  title,
  subtitle,
  metaItems = [],
  printOnly = false,
}) => {
  const { brand_name, logo_path, settings } = useBrandingStore();

  const legalName = settings?.legal_name || 'Nutribray';
  const brandName = brand_name || 'nutribray';
  const address = settings?.ho_address || settings?.reg_address || 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, Mathura Road, South Delhi – 110076';
  const phone = settings?.ho_phone || '74003 39365 / 82934 14222';
  const email = settings?.ho_email || '';
  const gstin = settings?.gstin || '07AAACG1234F1Z5';
  const logo = logo_path || '/nutribay_logo.svg';

  const containerClass = printOnly ? 'hidden print:block' : 'block';

  return (
    <div className={`${containerClass} pb-4 mb-4 border-b-2 border-slate-900 bg-white`}>
      <div className="flex items-start justify-between gap-4">
        {/* Left: Official Company Branding */}
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl border border-slate-200 bg-white p-1 flex items-center justify-center shrink-0 shadow-2xs">
            <img
              src={logo}
              alt={brandName}
              className="max-h-14 max-w-14 object-contain"
              onError={(e) => {
                e.currentTarget.src = '/nutribay_logo.svg';
              }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-[#8c2785] text-white">
                {brandName}
              </span>
              <span className="text-xs font-bold text-slate-800">{legalName}</span>
            </div>
            <p className="text-[11px] text-slate-600 mt-1 max-w-xl leading-tight">
              {address}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              Ph: <strong className="text-slate-700">{phone}</strong> • Email: <strong className="text-slate-700">{email}</strong> • GSTIN: <strong className="text-slate-700">{gstin}</strong>
            </p>
          </div>
        </div>

        {/* Right: Report Title & Print Metadata */}
        <div className="text-right shrink-0">
          <h2 className="text-lg font-black text-[#8c2785] tracking-tight uppercase">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-600 font-medium mt-0.5 max-w-xs ml-auto">
              {subtitle}
            </p>
          )}
          <div className="text-[10px] text-slate-500 font-mono mt-1 space-y-0.5">
            <div>Generated: <strong>{new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
            {metaItems.map((m, idx) => (
              m.value !== undefined && m.value !== null && m.value !== '' ? (
                <div key={idx}>
                  {m.label}: <strong className="text-slate-800">{m.value}</strong>
                </div>
              ) : null
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyReportHeader;
