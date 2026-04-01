// src/App.jsx
import { useAuth, AuthProvider } from './context/AuthContext';
import Login       from './pages/Login';
import DriverApp   from './pages/DriverApp';
// The coordinator/dashboard component from the original app, now connected to real API
import Dashboard   from './pages/Dashboard';
import CustomerPortal from './pages/CustomerPortal';

const GOOGLE_FONTS = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700;800&family=DM+Mono:wght@400;500&display=swap';

function Router() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ background: '#E40521', borderRadius: 8, padding: '6px 14px', display: 'inline-block', marginBottom: 16 }}>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 20, color: '#fff' }}>HONDA</span>
          </div>
          <div style={{ fontSize: 13, color: '#4B5563' }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  // Role-based routing
  if (user.role === 'driver')                           return <DriverApp />;
  if (user.role === 'customer')                         return <CustomerPortal />;
  if (user.role === 'coordinator' || user.role === 'admin') return <Dashboard />;

  return <Login />;
}

export default function App() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href={GOOGLE_FONTS} rel="stylesheet" />
      <AuthProvider>
        <Router />
      </AuthProvider>
    </>
  );
}
