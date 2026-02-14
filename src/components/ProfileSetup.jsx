import { useState } from 'react';

export default function ProfileSetup({ token, user, onSetup }) {
  const [bitName, setBitName] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!bitName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch('/api/profile/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bitName: bitName.trim() }),
      });
      if (!res.ok) throw new Error('Setup failed');
      const data = await res.json();
      onSetup(data.user);
    } catch (err) {
      console.error('Setup error:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="setup-container">
      <div className="setup-card">
        <div className="bit-shape setup-bit">
          <div className="bit-inner" />
        </div>
        <h1 className="setup-title">NAME YOUR BIT</h1>
        <p className="setup-subtitle">
          This is your AI doppelganger. Give it a name.
        </p>
        <form onSubmit={handleSubmit} className="setup-form">
          <input
            type="text"
            value={bitName}
            onChange={(e) => setBitName(e.target.value)}
            placeholder="Enter a name..."
            className="setup-input"
            maxLength={20}
            autoFocus
          />
          <button
            type="submit"
            className="setup-btn"
            disabled={!bitName.trim() || saving}
          >
            {saving ? 'CREATING...' : 'CREATE BIT'}
          </button>
        </form>
      </div>
    </div>
  );
}
