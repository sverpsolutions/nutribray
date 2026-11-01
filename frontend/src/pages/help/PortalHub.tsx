import React from 'react';

const portals = [
  {
    id: 'erp',
    name: 'Main ERP Portal',
    path: '/login',
    description: 'Central administrative dashboard for all backend operations.',
    icon: 'fas fa-desktop',
    color: 'from-blue-600 to-indigo-700'
  },
  {
    id: 'hht',
    name: 'HHT Terminal',
    path: '/hht',
    description: 'Mobile-optimized interface for warehouse putaway and barcode scanning.',
    icon: 'fas fa-barcode',
    color: 'from-emerald-500 to-teal-700'
  },
  {
    id: 'supplier',
    name: 'Supplier Portal',
    path: '/vendor-portal',
    description: 'External access for vendors to manage products, POs, and payments.',
    icon: 'fas fa-truck-loading',
    color: 'from-orange-500 to-red-600'
  },
  {
    id: 'attendance',
    name: 'Staff Attendance',
    path: '/hr/attendance',
    description: 'Employee clock-in/out and real-time attendance tracking.',
    icon: 'fas fa-user-clock',
    color: 'from-purple-600 to-pink-700'
  }
];

export default function PortalHub() {
  const baseUrl = window.location.origin;

  const getQrUrl = (path: string) => {
    const fullUrl = baseUrl + path;
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(fullUrl)}&bgcolor=ffffff&color=0f172a&margin=10`;
  };

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-black text-slate-800 dark:text-white mb-2">Portal Access Hub</h1>
          <p className="text-slate-500 text-lg">Scan QR codes to access mobile terminals or provide links to partners.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {portals.map((portal) => (
            <div 
              key={portal.id}
              className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col sm:flex-row transition-all hover:shadow-2xl hover:-translate-y-1"
            >
              <div className="p-10 flex-1">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${portal.color} text-white flex items-center justify-center text-2xl mb-6 shadow-lg`}>
                  <i className={portal.icon}></i>
                </div>
                
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-3">{portal.name}</h2>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed mb-8">
                  {portal.description}
                </p>

                <div className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Portal URL</span>
                    <code className="text-sm bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-xl text-blue-600 dark:text-blue-400 break-all select-all">
                      {baseUrl}{portal.path}
                    </code>
                  </div>
                  
                  <button 
                    onClick={() => window.open(portal.path, '_blank')}
                    className="w-full py-3 bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-2xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
                  >
                    Launch Portal <i className="fas fa-external-link-alt text-xs"></i>
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-10 flex flex-col items-center justify-center border-l border-slate-100 dark:border-slate-800 min-w-[280px]">
                <div className="bg-white p-4 rounded-3xl shadow-lg mb-4">
                  <img 
                    src={getQrUrl(portal.path)} 
                    alt={`${portal.name} QR Code`}
                    className="w-48 h-48 block rounded-xl"
                  />
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Scan to Login</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 p-8 bg-blue-600 rounded-[2.5rem] text-white flex flex-col md:flex-row items-center gap-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
          <div className="flex-1 relative z-10">
            <h3 className="text-2xl font-bold mb-2">Need a Custom Access Point?</h3>
            <p className="text-blue-100 opacity-90">
              You can generate a QR code for any form by navigating to that page and using the browser print option, or use the SAP Form IDs directly on your device.
            </p>
          </div>
          <div className="flex gap-4 relative z-10">
            <div className="text-center">
              <div className="text-4xl font-black mb-1">990</div>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">Portal ID</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
