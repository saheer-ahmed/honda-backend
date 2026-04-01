// src/pages/Login.jsx
import { useState } from 'react';
import { useAuth }  from '../context/AuthContext';

const HONDA_RED = '#E40521';

const ROLE_HINTS = [
  { role: 'coordinator', label: 'Coordinator', email: 'coordinator@honda-uae.com', pw: 'coord1234',   icon: '⊞' },
  { role: 'driver',      label: 'Driver',      email: 'driver@honda-uae.com',      pw: 'driver1234',  icon: '◈' },
  { role: 'customer',    label: 'Customer',    email: 'customer@example.com',       pw: 'customer1234',icon: '◎' },
];

export default function Login() {
  const { login }   = useAuth();
  const [form, setForm]     = useState({ email: '', password: '' });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const fillHint = (hint) => setForm({ email: hint.email, password: hint.pw });

  return (
    <div style={{
      minHeight: '100vh', background: '#0A0A0A', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ background: HONDA_RED, borderRadius: 8, padding: '6px 14px' }}>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 22, color: '#fff', letterSpacing: '0.06em' }}>HONDA</span>
            </div>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.08em' }}>SERVICE OPS</span>
          </div>
          <p style={{ fontSize: 13, color: '#4B5563' }}>Door-to-Door Service Platform</p>
        </div>

        {/* Card */}
        <div style={{ background: '#111', border: '1px solid #1F1F1F', borderRadius: 16, padding: '32px 32px 24px', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}>
          <h2 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Sign in</h2>
          <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>Access your Honda Service dashboard</p>

          {error && (
            <div style={{ background: '#1A0505', border: '1px solid #7F1D1D', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#FCA5A5' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Email or Phone
              </label>
              <input
                type="text" value={form.email} autoComplete="username"
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@example.com"
                style={{ width: '100%', padding: '12px 14px', background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, fontSize: 14, color: '#F9FAFB', outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#4B5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Password
              </label>
              <input
                type="password" value={form.password} autoComplete="current-password"
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                style={{ width: '100%', padding: '12px 14px', background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, fontSize: 14, color: '#F9FAFB', outline: 'none' }}
              />
            </div>
            <button
              type="submit" disabled={loading}
              style={{ width: '100%', padding: '13px', background: loading ? '#7F0010' : HONDA_RED, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.04em', fontFamily: "'Barlow',sans-serif", transition: 'background 0.15s' }}
            >
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>
        </div>

        {/* Demo hints */}
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 11, color: '#374151', textAlign: 'center', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Quick Access (Demo)</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {ROLE_HINTS.map(hint => (
              <button key={hint.role} onClick={() => fillHint(hint)}
                style={{ padding: '10px 8px', background: '#111', border: '1px solid #1F1F1F', borderRadius: 10, cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s' }}
                onMouseOver={e => e.currentTarget.style.borderColor = '#374151'}
                onMouseOut={e  => e.currentTarget.style.borderColor = '#1F1F1F'}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>{hint.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF' }}>{hint.label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
