import { useState, type FormEvent, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Building2, Lock, Eye, EyeOff, ShieldCheck,
  CheckCircle2, AlertCircle, RefreshCw, ArrowRight
} from 'lucide-react'
import { vendor_portal_api } from '../../api/vendorPortal'
import { useAuthStore } from '../../store/authStore'
import toast from 'react-hot-toast'

export default function VendorPortalActivate() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { set_auth } = useAuthStore()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const isReset = window.location.pathname.includes('/reset-password')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token) {
      setErrorMsg('Activation or reset token is missing from the link.')
      return
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please re-enter carefully.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    try {
      if (isReset) {
        await vendor_portal_api.reset_password({
          token,
          new_password: password,
        })
        toast.success('Password updated successfully! Please log in.')
        setSuccess(true)
      } else {
        const res = await vendor_portal_api.activate({
          token,
          password,
        })
        if (res.data.access_token) {
          set_auth(res.data.access_token, {
            id: 0,
            name: res.data.username || 'Vendor',
            username: res.data.username || 'vendor',
            email: null,
            role: 'vendor',
            role_id: null,
            outlet_id: null,
          })
          toast.success('Account activated! Welcome to Nutribay Vendor Portal.')
          navigate('/vendor-portal', { replace: true })
          return
        }
        setSuccess(true)
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Activation link is invalid or has expired. Please contact purchasing.'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden font-sans">
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-emerald-500 shadow-xl shadow-blue-500/25 mb-2">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-black tracking-tight text-white">
            {isReset ? 'Set New Password' : 'Set Up Your Vendor Account'}
          </h2>
          <p className="text-xs uppercase tracking-widest text-emerald-400 font-bold">
            Nutribay Vendor Portal Security
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10">
            {success ? (
              <div className="text-center space-y-4 py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-white">
                  {isReset ? 'Password Changed Successfully' : 'Account Activated Successfully'}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your credentials have been securely registered. You can now log into your vendor self-service dashboard.
                </p>
                <div className="pt-2">
                  <Link
                    to="/vendor/login"
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 transition-all shadow-md"
                  >
                    Proceed to Vendor Login
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {errorMsg && (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-rose-300 font-medium leading-relaxed">{errorMsg}</p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                    {isReset ? 'New Password' : 'Create Password'}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-500/25 active:scale-[0.99] transition-all disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Saving Password…
                      </>
                    ) : (
                      <>
                        {isReset ? 'Save New Password' : 'Set Password & Activate'}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
              <Link to="/vendor/login" className="text-xs text-slate-400 hover:text-slate-200">
                Already set up your password? <span className="text-blue-400 font-bold hover:underline">Log in</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
