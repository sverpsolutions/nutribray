import { useState, type FormEvent, useEffect, useRef } from 'react'
import { enterFull } from '../../utils/fullscreen'
import { useAuth } from '../../hooks/useAuth'

/* ------------------------------------------------------------------ */
/*  Premium Login Page — Nutribay                                */
/* ------------------------------------------------------------------ */

export default function LoginPage() {
  const { login, loading, error } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [shake, setShake] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  useEffect(() => {
    if (error) {
      setShake(true)
      const t = setTimeout(() => setShake(false), 500)
      return () => clearTimeout(t)
    }
  }, [error])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    enterFull()  // the Login click is the moment the browser allows full screen: open like a desktop app
    await login({ username, password })
  }

  return (
    <div className="login-root">
      {/* animated background orbs */}
      <div className="login-bg">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="orb orb-4" />
      </div>

      {/* glass card */}
      <div className={`login-card${shake ? ' shake' : ''}`}>
        {/* header */}
        <div className="login-header">
          <div className="login-logo" style={{ background: 'transparent', boxShadow: 'none' }}>
            <img 
              src="/nutribay_logo.svg" 
              alt="NUTRIBAY Logo" 
              style={{ maxHeight: '68px', width: 'auto', margin: '0 auto', filter: 'drop-shadow(0 4px 12px rgba(140, 39, 133, 0.4))' }} 
            />
          </div>
          <h1 className="login-title" style={{ marginTop: '0.75rem', letterSpacing: '-0.02em' }}>NUTRIBAY</h1>
          <p className="login-subtitle">Nutribay • Manufacturing ERP</p>
        </div>

        {/* form */}
        <form onSubmit={handleSubmit} className="login-form">
          {/* username */}
          <div className="field-group">
            <label htmlFor="login-username" className="field-label">
              Username
            </label>
            <div className="input-wrapper">
              <span className="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                ref={usernameRef}
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="field-input"
                placeholder="Enter your username"
              />
            </div>
          </div>

          {/* password */}
          <div className="field-group">
            <label htmlFor="login-password" className="field-label">
              Password
            </label>
            <div className="input-wrapper">
              <span className="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input"
                placeholder="Enter your password"
              />
              <button
                type="button"
                tabIndex={-1}
                className="toggle-pw"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* error */}
          {error && (
            <div className="error-banner" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* submit */}
          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            className="submit-btn"
          >
            {loading ? (
              <span className="spinner-wrap">
                <span className="spinner" />
                Signing in…
              </span>
            ) : (
              <span className="btn-content">
                Sign In
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            )}
          </button>
        </form>

        {/* footer */}
        <p className="login-footer">
          Nutribay Manufacturing ERP Manufacturing ERP &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* scoped styles */}
      <style>{`
        /* --------- ROOT --------- */
        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg, #100816 0%, #200d28 50%, #0c1224 100%);
          font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif;
        }

        /* --------- ANIMATED ORB BACKGROUND --------- */
        .login-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
        .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.45;
          animation: float 20s ease-in-out infinite;
        }
        .orb-1 { width: 420px; height: 420px; top: -10%; left: -8%;  background: #8c2785; animation-delay: 0s; }
        .orb-2 { width: 350px; height: 350px; bottom: -12%; right: -6%; background: #2c57a4; animation-delay: -5s; }
        .orb-3 { width: 280px; height: 280px; top: 50%; left: 60%;   background: #a56aa1; animation-delay: -10s; }
        .orb-4 { width: 200px; height: 200px; top: 20%; right: 25%;  background: #6d1f67; animation-delay: -15s; opacity: 0.3; }

        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(30px, -30px) scale(1.05); }
          66%      { transform: translate(-20px, 20px) scale(0.95); }
        }

        /* --------- GLASS CARD --------- */
        .login-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          margin: 1rem;
          padding: 2.5rem 2rem 2rem;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 1.5rem;
          backdrop-filter: blur(24px) saturate(1.6);
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          animation: cardEntry 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes cardEntry {
          from { opacity: 0; transform: translateY(30px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .login-card.shake {
          animation: shakeAnim 0.5s ease;
        }
        @keyframes shakeAnim {
          0%, 100% { transform: translateX(0); }
          20%      { transform: translateX(-12px); }
          40%      { transform: translateX(10px); }
          60%      { transform: translateX(-8px); }
          80%      { transform: translateX(6px); }
        }

        /* --------- HEADER --------- */
        .login-header { text-align: center; margin-bottom: 2rem; }
        .login-logo { display: flex; justify-content: center; margin-bottom: 1rem; }
        .logo-icon { width: 56px; height: 56px; filter: drop-shadow(0 4px 12px rgba(99, 102, 241, 0.4)); }
        .login-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -0.02em;
          background: linear-gradient(135deg, #c7d2fe, #e0e7ff, #a5b4fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin: 0 0 0.25rem;
        }
        .login-subtitle {
          font-size: 0.8rem;
          color: rgba(165, 180, 252, 0.6);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin: 0;
        }

        /* --------- FORM --------- */
        .login-form { display: flex; flex-direction: column; gap: 1.25rem; }

        .field-group { display: flex; flex-direction: column; gap: 0.4rem; }
        .field-label {
          font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 500;
          color: rgba(199, 210, 254, 0.7);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        .input-icon {
          position: absolute;
          left: 14px;
          color: rgba(165, 180, 252, 0.45);
          display: flex;
          pointer-events: none;
          transition: color 0.2s;
        }
        .input-wrapper:focus-within .input-icon {
          color: #a5b4fc;
        }
        .field-input {
          width: 100%;
          padding: 0.75rem 2.8rem 0.75rem 2.8rem;
          font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
          font-size: 14px;
          color: #e0e7ff;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.75rem;
          outline: none;
          transition: all 0.25s ease;
        }
        .field-input::placeholder {
          color: rgba(165, 180, 252, 0.3);
        }
        .field-input:focus {
          border-color: rgba(139, 92, 246, 0.5);
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12), 0 0 20px rgba(139, 92, 246, 0.08);
        }

        .toggle-pw {
          position: absolute;
          right: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: rgba(165, 180, 252, 0.4);
          transition: color 0.2s;
          padding: 4px;
        }
        .toggle-pw:hover { color: #a5b4fc; }

        /* --------- ERROR --------- */
        .error-banner {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.65rem 0.9rem;
          font-size: 0.82rem;
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 0.75rem;
          animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

        /* --------- SUBMIT --------- */
        .submit-btn {
          width: 100%;
          padding: 0.8rem;
          font-size: 0.95rem;
          font-weight: 700;
          color: #fff;
          background: linear-gradient(135deg, #8c2785, #2c57a4);
          border: none;
          border-radius: 0.75rem;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
          margin-top: 0.25rem;
        }
        .submit-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.15), transparent);
          opacity: 0;
          transition: opacity 0.3s;
        }
        .submit-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 25px rgba(140, 39, 133, 0.45);
        }
        .submit-btn:hover:not(:disabled)::before { opacity: 1; }
        .submit-btn:active:not(:disabled) { transform: translateY(0); }
        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-content {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        /* spinner */
        .spinner-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
        }
        .spinner {
          width: 18px;
          height: 18px;
          border: 2.5px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* --------- FOOTER --------- */
        .login-footer {
          text-align: center;
          font-size: 0.72rem;
          color: rgba(165, 180, 252, 0.3);
          margin: 1.75rem 0 0;
        }

        /* --------- RESPONSIVE --------- */
        @media (max-width: 480px) {
          .login-card { padding: 2rem 1.5rem 1.5rem; }
          .login-title { font-size: 1.5rem; }
        }
      `}</style>
    </div>
  )
}
