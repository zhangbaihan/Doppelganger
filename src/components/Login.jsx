import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';

export default function Login({ onLogin }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSuccess(credentialResponse) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auth failed');
      onLogin(data.token, data.user);
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="bit-shape login-bit">
          <div className="bit-inner" />
        </div>
        <h1 className="app-title">DOPPELGANGER</h1>
        <p className="app-subtitle">Let your AI doppelganger go on dates for you, before you do!</p>
        {error && <div className="error-toast" style={{ position: 'static', transform: 'none' }}>{error}</div>}
        {loading && <p className="app-subtitle">Signing in...</p>}
        <div className="google-btn-wrapper">
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => setError('Google sign-in failed. Check authorized origins.')}
            theme="filled_black"
            shape="pill"
            size="large"
          />
        </div>
      </div>
    </div>
  );
}
