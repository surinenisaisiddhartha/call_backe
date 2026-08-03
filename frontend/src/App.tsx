import React, { useState } from 'react';
import api from './api';
import Login from './pages/Login';
import Contacts from './pages/Contacts';
import Scheduling from './pages/Scheduling';
import Settings from './pages/Settings';
import Campaigns from './pages/Campaigns';
import Dashboard from './pages/Dashboard';
import Schools from './pages/Schools';
import {
  Users, Settings as SettingsIcon, LogOut, MessageSquare,
  BarChart2, CalendarCheck, Sun, Moon, LayoutDashboard,
  PanelLeftClose, PanelLeftOpen, School as SchoolIcon
} from 'lucide-react';
type Tab = 'dashboard' | 'campaigns' | 'contacts' | 'scheduling' | 'settings' | 'schools';

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('theme') as 'dark' | 'light') || 'light'
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    localStorage.getItem('sidebar_collapsed') === '1'
  );

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      localStorage.setItem('sidebar_collapsed', prev ? '0' : '1');
      return !prev;
    });
  };

  // The signed-in user (role + which school they belong to). Seeded from
  // localStorage so a refresh doesn't flash the wrong nav, then reconciled
  // against /auth/me — the token may be a Cognito ID token whose claims the
  // frontend shouldn't be trusted to interpret on its own.
  const [user, setUser] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });

  React.useEffect(() => {
    if (!token) return;
    api.get('/auth/me')
      .then(res => {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
      })
      .catch(() => {
        // Token no longer valid (expired/rotated) — force a clean re-login.
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
      });
  }, [token]);

  const userRole = user?.role || 'user';
  const schoolName = user?.school_name || null;
  const schoolLogo = user?.school_logo || null;

  // The URL carries which school's dashboard you're looking at:
  //   #shri-ram-academy/contacts
  // A platform admin isn't scoped to one school, so they get 'platform'.
  // This is the school's slug rather than its display name because a name
  // like "The Shri Ram Academy" would have to be percent-encoded in a URL.
  const schoolSlug = user?.school_slug || (userRole === 'admin' ? 'platform' : null);

  const allowedTabsFor = (role: string): Tab[] => {
    const tabs: Tab[] = ['dashboard', 'campaigns', 'contacts', 'scheduling'];
    if (role === 'admin') tabs.push('settings', 'schools');
    return tabs;
  };

  /**
   * Reads the tab out of the hash, accepting both the current
   * "#<slug>/<tab>" form and the older bare "#<tab>" form — old bookmarks and
   * any link shared before this change must keep working.
   */
  const tabFromHash = (): Tab | null => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    if (!raw) return null;
    const segments = raw.split('/').filter(Boolean);
    const candidate = (segments.length > 1 ? segments[1] : segments[0]) as Tab;
    return allowedTabsFor(userRole).includes(candidate) ? candidate : null;
  };

  const getInitialTab = (): Tab => tabFromHash() || 'dashboard';
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab());

  const hashFor = (tab: Tab) => (schoolSlug ? `#${schoolSlug}/${tab}` : `#${tab}`);

  // Keep the address bar canonical: once we know which school the signed-in
  // user belongs to, rewrite "#contacts" to "#shri-ram-academy/contacts".
  // Guarded on inequality so this never ping-pongs with the hashchange
  // listener below.
  React.useEffect(() => {
    if (!token || !user) return;
    const desired = hashFor(activeTab);
    if (window.location.hash !== desired) {
      window.location.replace(desired);
    }
  }, [token, user, activeTab, schoolSlug]);
  const [jumpToContactId, setJumpToContactId] = useState<string | null>(null);

  const viewContactFromElsewhere = (contactId: string) => {
    setJumpToContactId(contactId);
    setActiveTab('contacts');
    window.location.hash = hashFor('contacts');
  };

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  React.useEffect(() => {
    const handleHashChange = () => {
      const tab = tabFromHash();
      if (tab) setActiveTab(tab);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [userRole]);

  React.useEffect(() => {
    if ((activeTab === 'settings' || activeTab === 'schools') && userRole !== 'admin') {
      setActiveTab('dashboard');
    }
  }, [activeTab, userRole]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    // Date.now() alone collides when two toasts fire in the same millisecond
    // (e.g. several pages erroring at once), producing duplicate React keys.
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const handleLoginSuccess = (userToken: string, loggedInUser?: any) => {
    localStorage.setItem('token', userToken);
    if (loggedInUser) {
      localStorage.setItem('user', JSON.stringify(loggedInUser));
      setUser(loggedInUser);
    }
    setToken(userToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setToken(null);
    showToast('Logged out successfully', 'success');
  };

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />;
  }

  const navItems: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: 'dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { tab: 'campaigns', icon: <BarChart2 size={20} />, label: 'Campaigns' },
    { tab: 'contacts', icon: <Users size={20} />, label: 'Leads Directory' },
    { tab: 'scheduling', icon: <CalendarCheck size={20} />, label: 'Scheduling' },
  ];

  if (userRole === 'admin') {
    navItems.push({ tab: 'schools', icon: <SchoolIcon size={20} />, label: 'Schools' });
    navItems.push({ tab: 'settings', icon: <SettingsIcon size={20} />, label: 'System Settings' });
  }

  return (
    <div className="app-container">
      {/* Global Top Header */}
      <header className="top-header" style={{
        height: '74px',
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-color)',
        padding: '0 30px'
      }}>
        <div className="left-section" style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div className="logo-container" style={{ margin: 0, paddingRight: '24px', borderRight: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', padding: '8px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.25)' }}>
              <MessageSquare style={{ color: '#fff', flexShrink: 0 }} size={22} />
            </div>
            <span className="logo-text" style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>EnquiryCall</span>
          </div>

          <div className="header-brand-label" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', overflow: 'hidden' }}>
              {schoolLogo ? (
                <img src={schoolLogo.startsWith('http') ? schoolLogo : `http://localhost:5000${schoolLogo}`} alt="School Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : !schoolName && userRole === 'admin' ? (
                <img src="https://ui-avatars.com/api/?name=RI&background=4f46e5&color=fff&rounded=true&bold=true" alt="Response Informatics Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <SchoolIcon size={20} />
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '2px', fontWeight: 600 }}>
                {schoolName ? 'School Workspace' : 'Platform Access'}
              </div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                {schoolName || (userRole === 'admin' ? 'Admin Console' : user?.email || '—')}
              </div>
            </div>
          </div>

        </div>

        <div className="right-section" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, paddingLeft: '24px', borderLeft: '1px solid var(--border-color)' }}>
            Delivered by <br /><span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>Response Informatics</span>
          </div>
        </div>
      </header>

      <div className="main-layout">
        {/* Sidebar Navigation */}
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>

          <nav style={{ flexGrow: 1 }}>
            <ul className="nav-links">
              {navItems.map(({ tab, icon, label }) => (
                <li key={tab}>
                  <a
                    href={hashFor(tab)}
                    className={`nav-link ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                    title={sidebarCollapsed ? label : undefined}
                  >
                    {icon}
                    <span className="nav-label">{label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="sidebar-bottom-actions" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center' }}
              title={sidebarCollapsed ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : undefined}
            >
              {theme === 'dark' ? <Sun size={18} style={{ flexShrink: 0 }} /> : <Moon size={18} style={{ flexShrink: 0 }} />}
              <span className="nav-label">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>

            <button
              onClick={handleLogout}
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center' }}
              title={sidebarCollapsed ? 'Sign Out' : undefined}
            >
              <LogOut size={18} style={{ flexShrink: 0 }} />
              <span className="nav-label">Sign Out</span>
            </button>
          </div>

        </aside>

        {/* Main Content Area */}
        <main className={`main-content ${sidebarCollapsed ? 'expanded' : ''}`}>
          {activeTab === 'dashboard' && <Dashboard showToast={showToast} onViewContact={viewContactFromElsewhere} />}
          {activeTab === 'campaigns' && <Campaigns showToast={showToast} onViewContact={viewContactFromElsewhere} />}
          {activeTab === 'contacts' && <Contacts showToast={showToast} jumpToContactId={jumpToContactId} onJumpHandled={() => setJumpToContactId(null)} />}
          {activeTab === 'scheduling' && <Scheduling showToast={showToast} />}
          {activeTab === 'schools' && userRole === 'admin' && <Schools showToast={showToast} />}
          {activeTab === 'settings' && userRole === 'admin' && <Settings showToast={showToast} />}
        </main>
      </div>

      {/* Toast Alert System */}
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 9999 }}>
        {toasts.map(t => (
          <div
            key={t.id}
            className="toast"
            style={{ borderLeft: `4px solid ${t.type === 'success' ? 'var(--accent-success)' : 'var(--accent-error)'}` }}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
