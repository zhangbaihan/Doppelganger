import { useState } from 'react';

export default function ProfileSetup({ token, user, onSetup, onLogout }) {
  const [form, setForm] = useState({
    realName: user.name || '',
    age: '',
    genderIdentity: '',
    race: '',
    height: '',
    sexualOrientation: '',
  });
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const isValid =
    form.realName.trim() &&
    form.age.trim() &&
    form.genderIdentity.trim() &&
    form.race.trim() &&
    form.height.trim() &&
    form.sexualOrientation.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;

    setSaving(true);
    try {
      const res = await fetch('/api/profile/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...form, bitName: form.realName.trim() }),
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
      <button className="logout-btn corner-logout" onClick={onLogout}>LOGOUT</button>
      <div className="setup-card">
        <div className="bit-shape setup-bit">
          <div className="bit-inner" />
        </div>
        <h1 className="setup-title">SET UP YOUR PROFILE</h1>
        <p className="setup-subtitle">
          Complete your profile so your AI doppelganger can start learning.
        </p>
        <form onSubmit={handleSubmit} className="setup-form">
          <div className="setup-field">
            <label className="setup-label">YOUR NAME</label>
            <input
              type="text"
              value={form.realName}
              onChange={(e) => update('realName', e.target.value)}
              placeholder="Real name"
              className="setup-input"
              maxLength={50}
            />
          </div>

          <div className="setup-row">
            <div className="setup-field">
              <label className="setup-label">AGE</label>
              <input
                type="text"
                value={form.age}
                onChange={(e) => update('age', e.target.value)}
                placeholder="e.g. 21"
                className="setup-input"
                maxLength={3}
              />
            </div>
            <div className="setup-field">
              <label className="setup-label">HEIGHT</label>
              <input
                type="text"
                value={form.height}
                onChange={(e) => update('height', e.target.value)}
                placeholder={`e.g. 5'10"`}
                className="setup-input"
                maxLength={10}
              />
            </div>
          </div>

          <div className="setup-field">
            <label className="setup-label">GENDER IDENTITY</label>
            <input
              type="text"
              value={form.genderIdentity}
              onChange={(e) => update('genderIdentity', e.target.value)}
              placeholder="How do you identify?"
              className="setup-input"
              maxLength={40}
            />
          </div>

          <div className="setup-field">
            <label className="setup-label">RACE</label>
            <input
              type="text"
              value={form.race}
              onChange={(e) => update('race', e.target.value)}
              placeholder="How do you identify?"
              className="setup-input"
              maxLength={60}
            />
          </div>

          <div className="setup-field">
            <label className="setup-label">SEXUAL ORIENTATION</label>
            <input
              type="text"
              value={form.sexualOrientation}
              onChange={(e) => update('sexualOrientation', e.target.value)}
              placeholder="How do you identify?"
              className="setup-input"
              maxLength={40}
            />
          </div>

          <button
            type="submit"
            className="setup-btn"
            disabled={!isValid || saving}
          >
            {saving ? 'CREATING...' : 'CREATE PROFILE'}
          </button>
        </form>
      </div>
    </div>
  );
}
