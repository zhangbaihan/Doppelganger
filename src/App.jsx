import { useState, useEffect } from 'react';
import Login from './components/Login';
import ProfileSetup from './components/ProfileSetup';
import Dashboard from './components/Dashboard';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('dg_token'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetchProfile();
    } else {
      setLoading(false);
    }
  }, [token]);

  async function fetchProfile() {
    try {
      const res = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Session expired');
      const data = await res.json();
      setUser(data.user);
    } catch {
      localStorage.removeItem('dg_token');
      setToken(null);
    } finally {
      setLoading(false);
    }
  }

  function handleLogin(newToken, newUser) {
    localStorage.setItem('dg_token', newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function handleProfileSetup(updatedUser) {
    setUser(updatedUser);
  }

  function handleUserUpdate(updatedFields) {
    setUser((prev) => ({ ...prev, ...updatedFields }));
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="bit-shape loading-bit" />
      </div>
    );
  }

  if (!token || !user) {
    return <Login onLogin={handleLogin} />;
  }

  if (!user.bit_name) {
    return <ProfileSetup token={token} user={user} onSetup={handleProfileSetup} />;
  }

  return <Dashboard token={token} user={user} onUserUpdate={handleUserUpdate} />;
}
