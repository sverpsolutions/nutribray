import React from 'react';
import { Trash2, ArrowLeft, Minus, Plus, ShoppingBag, User, Phone, Mail, MapPin, CheckCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useCartStore } from '../../store/useCartStore';
import { shopService } from '../../services/shopService';
import toast from 'react-hot-toast';

const Cart: React.FC = () => {
  const navigate = useNavigate();
  const { items, updateQuantity, removeItem, clearCart } = useCartStore();
  const [isPlacing, setIsPlacing] = React.useState(false);
  const [showCheckout, setShowCheckout] = React.useState(false);
  const [orderSuccess, setOrderSuccess] = React.useState<string | null>(null);
  
  // Customer form state
  const [customerName, setCustomerName] = React.useState('');
  const [customerPhone, setCustomerPhone] = React.useState('');
  const [customerEmail, setCustomerEmail] = React.useState('');
  const [deliveryAddress, setDeliveryAddress] = React.useState('');

  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const deliveryFee = subtotal > 500 ? 0 : 40;
  const total = subtotal + deliveryFee;

  if (orderSuccess) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center space-y-6">
        <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto animate-bounce">
          <CheckCircle className="w-14 h-14 text-green-600" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-slate-800">Order Placed! 🎉</h2>
          <p className="text-slate-500 text-lg">Your order <span className="font-bold text-green-600">{orderSuccess}</span> has been placed successfully.</p>
          <p className="text-slate-400 text-sm">Customer: <span className="font-semibold">{customerName}</span> ({customerPhone})</p>
        </div>
        <Link 
          to="/shop" 
          className="inline-flex items-center gap-2 px-8 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          Continue Shopping
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center space-y-6">
        <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
          <ShoppingBag className="w-12 h-12 text-slate-300" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-slate-800">Your cart is empty</h2>
          <p className="text-slate-500">Looks like you haven't added anything yet.</p>
        </div>
        <Link 
          to="/shop" 
          className="inline-flex items-center gap-2 px-8 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          Start Shopping
        </Link>
      </div>
    );
  }

  const handlePlaceOrder = async () => {
    if (!customerName.trim()) {
      toast.error("Please enter customer name");
      return;
    }
    if (!customerPhone.trim() || customerPhone.length < 10) {
      toast.error("Please enter a valid phone number");
      return;
    }

    setIsPlacing(true);
    try {
      const orderData = {
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_email: customerEmail.trim() || null,
        delivery_address: deliveryAddress.trim() || null,
        subtotal: subtotal,
        total_amount: total,
        delivery_fee: deliveryFee,
        items: items.map(i => ({
          product_id: i.id,
          name: i.name,
          qty: i.quantity,
          unit: i.unit,
          rate: i.price,
          total: i.price * i.quantity
        }))
      };
      const result = await shopService.placeOrder(orderData);
      setOrderSuccess(result.order_no);
      clearCart();
      toast.success("Order placed successfully!");
    } catch (err: any) {
      console.error('Order error:', err);
      toast.error(err?.response?.data?.detail || "Failed to place order. Please try again.");
    } finally {
      setIsPlacing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link to="/shop" className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1 className="text-3xl font-black text-slate-900">Your Cart</h1>
          <span className="text-sm font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{items.length} items</span>
        </div>
        <button 
          onClick={clearCart}
          className="text-red-500 font-bold flex items-center gap-2 hover:bg-red-50 px-4 py-2 rounded-xl transition-all"
        >
          <Trash2 className="w-4 h-4" />
          Clear All
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Items List */}
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => (
            <div key={item.id} className="bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-20 h-20 bg-slate-50 rounded-2xl overflow-hidden flex-shrink-0">
                <img src={item.image || `https://ui-avatars.com/api/?name=${item.name}&size=80`} alt={item.name} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-bold text-slate-800">{item.name}</h3>
                <p className="text-xs text-slate-500 font-medium">{item.unit || '1 unit'}</p>
                <div className="flex items-center gap-4 pt-2">
                  <div className="flex items-center gap-3 bg-slate-100 rounded-lg p-1">
                    <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="p-1 hover:bg-slate-200 rounded-md transition-colors"><Minus className="w-3 h-3" /></button>
                    <span className="font-bold text-sm">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="p-1 hover:bg-slate-200 rounded-md transition-colors"><Plus className="w-3 h-3" /></button>
                  </div>
                  <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-slate-900">₹{item.price * item.quantity}</p>
                <p className="text-xs text-slate-400 font-medium">₹{item.price} / unit</p>
              </div>
            </div>
          ))}

          {/* Customer Details Section */}
          {showCheckout && (
            <div className="bg-white border-2 border-green-200 rounded-3xl p-6 space-y-5 shadow-lg shadow-green-50 animate-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-800">Customer Details</h3>
                  <p className="text-xs text-slate-400 font-medium">New customer will be automatically registered</p>
                </div>
              </div>
              
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3 h-3" />
                    Customer Name *
                  </label>
                  <input 
                    type="text"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="Enter customer name"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-green-400 focus:border-green-400 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Phone className="w-3 h-3" />
                    Phone Number *
                  </label>
                  <input 
                    type="tel"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="Enter phone number"
                    maxLength={10}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-green-400 focus:border-green-400 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Mail className="w-3 h-3" />
                    Email (Optional)
                  </label>
                  <input 
                    type="email"
                    value={customerEmail}
                    onChange={e => setCustomerEmail(e.target.value)}
                    placeholder="Enter email address"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-green-400 focus:border-green-400 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" />
                    Delivery Address (Optional)
                  </label>
                  <input 
                    type="text"
                    value={deliveryAddress}
                    onChange={e => setDeliveryAddress(e.target.value)}
                    placeholder="Enter delivery address"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-green-400 focus:border-green-400 outline-none transition-all"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Summary Card */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-xl shadow-slate-200/50 space-y-6 sticky top-24">
            <h2 className="text-xl font-bold text-slate-800">Order Summary</h2>
            <div className="space-y-4 font-medium">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span className="text-slate-800">₹{subtotal}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Delivery Fee</span>
                <span className={deliveryFee === 0 ? "text-green-600" : "text-slate-800"}>
                  {deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`}
                </span>
              </div>
              {deliveryFee > 0 && (
                <div className="bg-green-50 text-green-700 text-[10px] p-2 rounded-lg text-center font-bold">
                  Add items worth ₹{500 - subtotal} more for FREE delivery
                </div>
              )}
              <div className="border-t border-dashed border-slate-200 pt-4 flex justify-between text-xl font-black text-slate-900">
                <span>Total</span>
                <span>₹{total}</span>
              </div>
            </div>

            {!showCheckout ? (
              <button 
                onClick={() => setShowCheckout(true)}
                className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-green-100"
              >
                Proceed to Checkout
              </button>
            ) : (
              <button 
                disabled={isPlacing}
                onClick={handlePlaceOrder}
                className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-black text-lg transition-all shadow-xl shadow-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPlacing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </span>
                ) : (
                  `Place Order • ₹${total}`
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;
