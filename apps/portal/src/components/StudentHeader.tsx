import { useState } from 'react';
import { Link } from 'react-router-dom';

interface StudentHeaderProps {
  user?: any;
  onLogout?: () => void;
}

export function StudentHeader({ user, onLogout }: StudentHeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const mockNotifications = [
    { id: 1, title: 'Fall 2026 Registration Open', time: '10m ago', unread: true },
    { id: 2, title: 'Tuition Payment Confirmation', time: '2h ago', unread: true },
    { id: 3, title: 'Midterm Grade Released for BIB-101', time: '1d ago', unread: false },
  ];

  return (
    <header className="student-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--navy)', background: 'rgba(212, 175, 55, 0.15)', border: '1px solid rgba(212, 175, 55, 0.4)', padding: '4px 12px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} />
          Fall 2026 Academic Term
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Search Input */}
        <div className="student-header-search">
          <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: 'var(--slate)' }}>
            🔍
          </span>
          <input type="text" placeholder="Search courses, invoices, tickets..." />
        </div>

        {/* Notification Icon & Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '50%', width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}
            title="Notifications"
          >
            🔔
            <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)' }} />
          </button>

          {showNotifications && (
            <div style={{ position: 'absolute', top: '120%', right: 0, width: 320, background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 100, padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                <strong style={{ fontSize: '0.9rem', color: 'var(--navy)' }}>Notifications</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--gold-dark)', fontWeight: 600 }}>Mark all read</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {mockNotifications.map((n) => (
                  <div key={n.id} style={{ padding: '0.6rem', borderRadius: '6px', background: n.unread ? 'rgba(212, 175, 55, 0.08)' : 'transparent', border: n.unread ? '1px solid rgba(212, 175, 55, 0.2)' : 'none' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: n.unread ? 700 : 500, color: 'var(--navy)' }}>{n.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--slate)' }}>{n.time}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Profile Avatar & Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            style={{ background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
          >
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--navy)', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.9rem', border: '2px solid var(--gold)' }}>
              {user?.first_name ? user.first_name[0].toUpperCase() : 'S'}
            </div>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--navy)' }}>
              {user?.first_name || 'Account'} ▾
            </span>
          </button>

          {showProfileMenu && (
            <div style={{ position: 'absolute', top: '120%', right: 0, width: 200, background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 100, padding: '0.5rem 0' }}>
              <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{user?.first_name} {user?.last_name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--slate)' }}>{user?.email}</div>
              </div>
              <Link to="/student/settings" className="dropdown-item">⚙️ Account Settings</Link>
              <Link to="/student/support" className="dropdown-item">🎫 Contact Support</Link>
              <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.25rem', paddingTop: '0.25rem' }}>
                <button
                  onClick={onLogout}
                  className="dropdown-item"
                  style={{ color: 'var(--danger)', fontWeight: 600 }}
                >
                  🚪 Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
