import React from 'react';
import { Plus, Minus, ShoppingBag } from 'lucide-react';
import { useCartStore } from '../../store/useCartStore';

interface ProductCardProps {
  product: any;
}

const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { addItem, updateQuantity, items } = useCartStore();
  const cartItem = items.find((i) => i.id === product.id);

  return (
    <div className="bg-white border border-slate-100 rounded-3xl p-3 md:p-4 transition-all group relative tactile-card">
      {/* Product Image */}
      <div className="aspect-square rounded-2xl overflow-hidden bg-slate-50 mb-4 relative">
        <img
          src={product.thumbnail_img || product.image_path || `https://ui-avatars.com/api/?name=${product.name}&background=f8fafc&color=64748b&size=200`}
          alt={product.name}
          className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-500"
        />
        {product.discount > 0 && (
          <div className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase">
            {product.discount}% OFF
          </div>
        )}
      </div>

      {/* Product Info */}
      <div className="space-y-1">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{product.brand || 'Local'}</span>
        <h3 className="text-sm md:text-base font-bold text-slate-800 line-clamp-2 min-h-[2.5rem]">
          {product.name}
        </h3>
        <p className="text-xs font-medium text-slate-500">{product.unit || '1 unit'}</p>
      </div>

      {/* Pricing & Add Button */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-lg font-black text-slate-900">₹{product.selling_price}</span>
          {parseFloat(product.mrp) > parseFloat(product.selling_price) && (
            <span className="text-xs text-slate-400 line-through font-medium">₹{product.mrp}</span>
          )}
        </div>

        {cartItem ? (
          <div className="flex items-center gap-3 bg-slate-900 text-white rounded-2xl p-1.5 shadow-xl shadow-slate-200 tactile-btn">
            <button
              onClick={() => updateQuantity(product.id, cartItem.quantity - 1)}
              className="p-1 hover:bg-slate-800 rounded-xl transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="font-black text-sm w-4 text-center">{cartItem.quantity}</span>
            <button
              onClick={() => updateQuantity(product.id, cartItem.quantity + 1)}
              className="p-1 hover:bg-slate-800 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => addItem(product)}
            className="p-2 md:px-6 md:py-2.5 bg-yellow-400 text-slate-900 rounded-2xl font-black text-sm transition-all flex items-center gap-2 tactile-btn border-b-4 border-yellow-600 active:border-b-0 active:translate-y-1"
          >
            <Plus className="w-4 h-4" />
            <span>ADD</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default ProductCard;
