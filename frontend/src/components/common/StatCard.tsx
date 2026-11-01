import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: string;
  color: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, subValue, icon, color }) => {
  return (
    <div className="card shadow-sm h-full" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="card-body py-2 px-3">
        <div className="text-slate-500 text-xs uppercase font-semibold tracking-wider">{label}</div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-2xl font-bold" style={{ color }}>{value}</div>
          {icon && <i className={`${icon} opacity-20 text-2xl`}></i>}
        </div>
        {subValue && <div className="text-[10px] text-slate-400 mt-1">{subValue}</div>}
      </div>
    </div>
  );
};

export default StatCard;
