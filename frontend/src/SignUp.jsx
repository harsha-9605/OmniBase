import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'
import api from './api'

function SignUp({ mode = 'signup' }) {
  const navigate = useNavigate()
  const isSignIn = mode === 'signin'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [googleLoading, setGoogleLoading] = useState(false)

  // Google One-Tap / popup sign-in handler
  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      // tokenResponse.access_token is a Google OAuth access token
      // We need to exchange it for user info to get the ID token.
      // @react-oauth/google's useGoogleLogin returns an access_token,
      // so we fetch user info from Google then call our backend.
      setGoogleLoading(true)
      setError('')
      try {
        // Get user profile from Google
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
        })
        const userInfo = await userInfoRes.json()
        
        // Send to our backend (using the access token approach)
        const res = await api.post('/auth/google-token', {
          access_token: tokenResponse.access_token,
          name: userInfo.name,
          email: userInfo.email,
        })
        
        const { access_token, tenant_id } = res.data
        localStorage.setItem('omnibase_token', access_token)
        if (tenant_id) {
          localStorage.setItem('omnibase_last_tenant', tenant_id.toString())
          navigate('/workspace/' + tenant_id, { replace: true })
        } else {
          navigate('/workspaces', { replace: true })
        }
      } catch (err) {
        setError(err.response?.data?.detail || 'Google sign-in failed. Please try again.')
      } finally {
        setGoogleLoading(false)
      }
    },
    onError: () => setError('Google sign-in was cancelled or failed.'),
    flow: 'implicit',
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      let res;
      if (isSignIn) {
        res = await api.post('/accounts/login', { email, password })
      } else {
        res = await api.post('/auth/signup', { name, email, password })
      }
      
      const { access_token, tenant_id } = res.data
      localStorage.setItem('omnibase_token', access_token)
      if (tenant_id) {
        localStorage.setItem('omnibase_last_tenant', tenant_id.toString())
        navigate('/workspace/' + tenant_id, { replace: true })
      } else {
        navigate('/workspaces', { replace: true })
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-brand-bg text-text-primary overflow-x-hidden flex flex-col justify-center items-center py-10 px-6">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-grid-pattern z-0 pointer-events-none opacity-40" />
      <div className="absolute top-[-200px] right-[-80px] w-[600px] h-[600px] rounded-full bg-radial from-brand-accent/20 to-transparent blur-[130px] z-0 pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-80px] w-[500px] h-[500px] rounded-full bg-radial from-brand-teal/10 to-transparent blur-[130px] z-0 pointer-events-none" />

      {/* Auth Content */}
      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-[440px]">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5 font-extrabold text-xl tracking-tight text-text-primary hover:opacity-85 transition-opacity" id="auth-logo" onClick={(e) => { e.preventDefault(); navigate('/') }}>
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-brand-accent to-brand-accent-2 flex items-center justify-center text-sm shadow-[0_0_20px_var(--color-brand-accent-glow)] text-white" aria-hidden="true">⬡</div>
          OmniBase
        </a>

        {/* Card */}
        <div className="w-full bg-[#16161f] rounded-2xl p-8 md:p-10 border border-white/8 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_24px_60px_rgba(0,0,0,0.5),0_0_60px_rgba(124,92,252,0.08)] animate-fade-in-up" id="auth-card">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-center tracking-tight text-[#f0f0ff] mb-2 leading-tight" id="auth-heading">
            {isSignIn ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="text-sm text-text-secondary text-center mb-7 leading-relaxed">
            {isSignIn
              ? 'Sign in to your OmniBase workspace'
              : 'We suggest using your work email address.'}
          </p>

          <form className="flex flex-col gap-3.5 mb-5" id="auth-form" onSubmit={handleSubmit}>
            {!isSignIn && (
              <div className="flex flex-col">
                <input
                  id="auth-name"
                  type="text"
                  className="w-full px-4 py-3.5 text-[14.5px] text-text-primary bg-white/5 border border-white/12 rounded-xl placeholder-brand-accent/40 focus:border-brand-accent focus:bg-brand-accent/5 focus:shadow-[0_0_0_3px_rgba(124,92,252,0.2)] outline-none transition-all"
                  placeholder="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
            )}
            
            <div className="flex flex-col">
              <input
                id="auth-email"
                type="email"
                className="w-full px-4 py-3.5 text-[14.5px] text-text-primary bg-white/5 border border-white/12 rounded-xl placeholder-brand-accent/40 focus:border-brand-accent focus:bg-brand-accent/5 focus:shadow-[0_0_0_3px_rgba(124,92,252,0.2)] outline-none transition-all"
                placeholder="name@work-email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus={isSignIn}
                required
              />
            </div>

            <div className="flex flex-col">
              <input
                id="auth-password"
                type="password"
                className="w-full px-4 py-3.5 text-[14.5px] text-text-primary bg-white/5 border border-white/12 rounded-xl placeholder-brand-accent/40 focus:border-brand-accent focus:bg-brand-accent/5 focus:shadow-[0_0_0_3px_rgba(124,92,252,0.2)] outline-none transition-all"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            {error && (
              <div className="text-red-400 text-sm font-medium text-center">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="w-full py-3.5 text-sm font-bold text-white bg-gradient-to-r from-brand-accent to-brand-accent-2 hover:to-[#a259ff] rounded-xl cursor-pointer shadow-[0_0_28px_rgba(124,92,252,0.4)] hover:shadow-[0_0_40px_rgba(124,92,252,0.5)] hover:-translate-y-0.5 transition-all tracking-wide disabled:opacity-50" id="auth-submit">
              {loading ? 'Processing...' : (isSignIn ? 'Sign in' : 'Continue')}
            </button>
          </form>

          {/* Social Divider */}
          <div className="flex items-center gap-3 my-5">
            <span className="flex-1 h-[1px] bg-white/8" />
            <span className="text-[11.5px] font-bold text-text-muted tracking-widest">OR</span>
            <span className="flex-1 h-[1px] bg-white/8" />
          </div>

          {/* Social Logins */}
          <div className="flex flex-col gap-2.5 mb-6" id="auth-social">
            <button
              type="button"
              onClick={() => handleGoogleLogin()}
              disabled={googleLoading}
              className="flex items-center justify-center gap-2.5 w-full py-3 px-4 text-sm font-semibold text-text-secondary hover:text-text-primary bg-white/4 border border-white/10 hover:border-white/18 rounded-xl cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <button className="flex items-center justify-center gap-2.5 w-full py-3 px-4 text-sm font-semibold text-text-secondary hover:text-text-primary bg-white/4 border border-white/10 hover:border-white/18 rounded-xl cursor-pointer transition-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
              </svg>
              Continue with GitHub
            </button>
          </div>

          {/* Legal */}
          <p className="text-[12px] text-text-muted text-center leading-relaxed" id="auth-legal">
            By continuing, you're agreeing to our{' '}
            <a href="#" className="text-text-secondary hover:text-brand-accent-2 underline transition-colors">Terms of Service</a> and{' '}
            <a href="#" className="text-text-secondary hover:text-brand-accent-2 underline transition-colors">Privacy Policy</a>.
          </p>
        </div>

        {/* Footer Toggle Text */}
        <p className="text-[13.5px] text-text-muted text-center" id="auth-footer">
          {isSignIn ? (
            <>Don't have an account?{' '}<button className="bg-transparent border-none text-brand-accent-2 hover:text-purple-300 font-semibold cursor-pointer transition-colors" id="btn-switch-signup" onClick={() => navigate('/signup')}>Create one free</button></>
          ) : (
            <>Already using OmniBase?{' '}<button className="bg-transparent border-none text-brand-accent-2 hover:text-purple-300 font-semibold cursor-pointer transition-colors" id="btn-switch-signin" onClick={() => navigate('/signin')}>Sign in to a workspace</button></>
          )}
        </p>

        {/* Bottom Nav Links */}
        <div className="flex gap-6 mt-2" id="auth-bottom-nav">
          <a href="#" className="text-[12px] text-brand-accent/40 hover:text-text-secondary transition-colors">Privacy & Terms</a>
          <a href="#" className="text-[12px] text-brand-accent/40 hover:text-text-secondary transition-colors">Contact Us</a>
          <a href="#" className="text-[12px] text-brand-accent/40 hover:text-text-secondary transition-colors">Status</a>
        </div>
      </div>
    </div>
  )
}

export default SignUp
