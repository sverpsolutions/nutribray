


const BOMRecipes = () => {
  const recipes = [
    { id: 1, name: 'Fish Finger Pack (500g)', output_qty: '500 g', raw: [{ item: 'King Fish Fillet', qty: '400 g' }, { item: 'Bread Crumbs', qty: '80 g' }, { item: 'Spice Mix', qty: '20 g' }], yield: 92, cost: 320, sell: 499, status: 'active' },
    { id: 2, name: 'Prawn Masala Ready Pack', output_qty: '250 g', raw: [{ item: 'Tiger Prawns (Cleaned)', qty: '200 g' }, { item: 'Masala Paste', qty: '40 g' }, { item: 'Oil', qty: '10 g' }], yield: 88, cost: 280, sell: 399, status: 'active' },
    { id: 3, name: 'Pomfret Steaks (4 pcs)', output_qty: '400 g', raw: [{ item: 'Pomfret (Whole)', qty: '550 g' }], yield: 73, cost: 450, sell: 599, status: 'active' },
    { id: 4, name: 'Surimi Balls (250g)', output_qty: '250 g', raw: [{ item: 'Fish Paste (Mixed)', qty: '200 g' }, { item: 'Starch', qty: '30 g' }, { item: 'Seasoning', qty: '20 g' }], yield: 95, cost: 120, sell: 199, status: 'draft' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-purple-600 text-white p-1.5 rounded-lg mr-2"><i className="fas fa-book"></i></span>
            BOM Recipes
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Bill of Materials — Production recipes & cost breakdown</p>
        </div>
        <button className="bg-purple-600 text-white font-bold py-2 px-5 rounded-lg shadow-lg hover:bg-purple-700 transition-all flex items-center text-xs">
          <i className="fas fa-plus-circle mr-2"></i> New Recipe
        </button>
      </div>

      {/* Recipe Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {recipes.map(r => (
          <div key={r.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-all">
            <div className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">{r.name}</h3>
                  <span className="text-[10px] text-slate-400">Output: {r.output_qty}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
              </div>

              {/* Raw Materials */}
              <div className="bg-slate-50 rounded-lg p-3 mb-3">
                <div className="text-[9px] text-slate-400 font-bold uppercase mb-2">Raw Materials</div>
                {r.raw.map((m, i) => (
                  <div key={i} className="flex justify-between text-xs py-0.5">
                    <span className="text-slate-600">{m.item}</span>
                    <span className="font-bold text-slate-700">{m.qty}</span>
                  </div>
                ))}
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-green-50 rounded-lg p-2">
                  <div className="text-lg font-black text-green-600">{r.yield}%</div>
                  <div className="text-[8px] text-slate-400 font-bold uppercase">Yield</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-2">
                  <div className="text-lg font-black text-blue-600">₹{r.cost}</div>
                  <div className="text-[8px] text-slate-400 font-bold uppercase">Cost</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-2">
                  <div className="text-lg font-black text-amber-600">₹{r.sell}</div>
                  <div className="text-[8px] text-slate-400 font-bold uppercase">MRP</div>
                </div>
              </div>
            </div>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex justify-between">
              <span className="text-[10px] text-green-600 font-bold">Margin: {(((r.sell - r.cost) / r.sell) * 100).toFixed(1)}%</span>
              <div className="flex gap-2">
                <button className="text-[10px] text-blue-600 font-bold hover:underline">Edit</button>
                <button className="text-[10px] text-slate-400 font-bold hover:underline">Duplicate</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BOMRecipes;
