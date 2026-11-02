import { useState, type FormEvent, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Building2, Lock, User, Eye, EyeOff, ShieldCheck,
  ArrowRight, KeyRound, AlertCircle, CheckCircle2, RefreshCw
} from 'lucide-react'
import { vendor_portal_api } from '../../api/vendorPortal'
import { useAuthStore } from '../../store/authStore'
import toast from 'react-hot-toast'

export default function VendorPortalLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { set_auth } = useAuthStore()

  const [isForgot, setIsForgot] = useState(searchParams.get('mode') === 'forgot')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Forgot password state
  const [forgotInput, setForgotInput] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLink, setForgotLink] = useState<string | null>(null)

  useEffect(() => {
    setErrorMsg(null)
  }, [username, password, forgotInput, isForgot])

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setErrorMsg('Please enter both username and password.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await vendor_portal_api.login({
        username: username.trim(),
        password,
      })

      const { access_token, user } = res.data
      set_auth(access_token, user)
      toast.success(`Welcome to Nutribray Vendor Portal, ${user.name || user.username}!`)
      navigate('/vendor-portal', { replace: true })
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Invalid credentials or portal access is disabled.'
      setErrorMsg(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!forgotInput.trim()) {
      setErrorMsg('Please enter your username or registered email address.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await vendor_portal_api.forgot_password({
        username_or_email: forgotInput.trim(),
      })
      setForgotSent(true)
      if (res.data.reset_link) {
        setForgotLink(res.data.reset_link)
      }
      toast.success('Password reset instructions processed.')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to process password reset.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden font-sans">
      {/* Background glowing gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-xl shadow-blue-500/25 mb-2">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-black tracking-tight text-white">
            Nutribray
          </h2>
          <p className="text-xs uppercase tracking-widest text-blue-400 font-bold">
            Supplier & Vendor Self-Service Portal
          </p>
        </div>

        {/* Card */}
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10">
            {errorMsg && (
              <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-rose-300 font-medium leading-relaxed">{errorMsg}</p>
              </div>
            )}

            {!isForgot ? (
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                    Username / Registered Email
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. sup_0020 or vendor@company.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsForgot(true)}
                      className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
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

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/25 active:scale-[0.99] transition-all disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Authenticating…
                      </>
                    ) : (
                      <>
                        Log In to Portal
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div className="text-center space-y-1 pb-2">
                  <h3 className="text-lg font-bold text-white">Reset Your Password</h3>
                  <p className="text-xs text-slate-400">
                    Enter your registered username or email to receive password reset instructions.
                  </p>
                </div>

                {forgotSent ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-emerald-300 leading-relaxed">
                        <p className="font-bold mb-1">Reset Request Generated</p>
                        <p>If your account exists in our system, the reset instructions have been recorded.</p>
                        {forgotLink && (
                          <div className="mt-3 pt-3 border-t border-emerald-500/20">
                            <p className="text-[11px] text-slate-300 mb-1">Direct Reset Link:</p>
                            <Link
                              to={forgotLink}
                              className="text-xs font-bold text-blue-400 hover:underline break-all"
                            >
                              Click here to set your new password
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setIsForgot(false)
                        setForgotSent(false)
                      }}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-all text-center block"
                    >
                      Back to Vendor Login
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                        Username or Registered Email
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <User className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          required
                          value={forgotInput}
                          onChange={(e) => setForgotInput(e.target.value)}
                          placeholder="e.g. sup_0020 or vendor@company.com"
                          className="w-full pl-10 pr-4 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsForgot(false)}
                        className="w-1/3 py-2.5 px-3 rounded-xl text-xs font-bold text-slate-400 bg-slate-800 hover:bg-slate-700 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-2/3 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Send Reset Link'}
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}

            {/* Footer Information */}
            <div className="mt-8 pt-6 border-t border-slate-800/80 text-center space-y-2">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Protected by Nutribray 256-bit ERP Security</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Staff member?{' '}
                <Link to="/login" className="text-blue-400 hover:underline">
                  Sign in through HO Internal Staff Login
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
