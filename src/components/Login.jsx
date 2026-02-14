import { GoogleLogin } from '@react-oauth/google';

export default function Login({ onLogin }) {
  async function handleSuccess(credentialResponse) {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential }),
      });
      if (!res.ok) throw new Error('Auth failed');
      const data = await res.json();
      onLogin(data.token, data.user);
    } catch (err) {
      console.error('Login error:', err);
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="bit-shape login-bit">
          <div className="bit-inner" />
        </div>
        <h1 className="app-title">DOPPELGANGER</h1>
        <p className="app-subtitle">Train your AI twin</p>
        <div className="google-btn-wrapper">
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => console.error('Google login failed')}
            theme="filled_black"
            shape="pill"
            size="large"
          />
        </div>
      </div>
    </div>
  );
}
