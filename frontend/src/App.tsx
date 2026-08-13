import React, { useState } from 'react';
import api from './api';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Contacts from './pages/Contacts';
import Scheduling from './pages/Scheduling';
import Settings from './pages/Settings';
import Campaigns from './pages/Campaigns';
import Dashboard from './pages/Dashboard';
import Schools from './pages/Schools';
import Insights from './pages/Insights';
import CounselorQueue from './pages/CounselorQueue';
import Classes from './pages/Classes';
import { useSSE } from './hooks/useSSE';
import {
  Users, Settings as SettingsIcon, LogOut,
  BarChart2, CalendarCheck, Sun, Moon, LayoutDashboard,
  PanelLeftClose, PanelLeftOpen, School as SchoolIcon, TrendingUp, Headphones,
  Phone, FileText, ChevronRight, Radio, BookOpen, GraduationCap, CalendarDays
} from 'lucide-react';
type Tab = 'dashboard' | 'campaigns' | 'contacts' | 'classes' | 'counselor' | 'counselors' | 'scheduling' | 'insights' | 'settings' | 'schools';

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

/** Rendered in BOTH the signed-out and signed-in trees — see the note at the
 *  `if (!token)` early return below. */
function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 9999, pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div
          key={t.id}
          className="toast hover-lift"
          style={{
            pointerEvents: 'auto',
            borderLeft: `4px solid ${t.type === 'success' ? 'var(--accent-success)' : 'var(--accent-error)'}`,
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <span style={{ fontSize: '1rem' }}>{t.type === 'success' ? '✨' : '⚠️'}</span>
          <span style={{ fontWeight: 500 }}>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    localStorage.getItem('sidebar_collapsed') === '1'
  );

  const [showLogin, setShowLogin] = useState<boolean>(window.location.hash === '#login');

  React.useEffect(() => {
    const handleHashChange = () => {
       if (window.location.hash === '#login') setShowLogin(true);
       else if (!window.location.hash || window.location.hash === '#home') setShowLogin(false);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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

  React.useEffect(() => {
    if (schoolName) {
      document.title = `${schoolName} Portal - EnquiryCall`;
    } else if (userRole === 'admin') {
      document.title = `Admin Console - EnquiryCall`;
    } else {
      document.title = 'EnquiryCall | AI Admissions Calling';
    }
  }, [schoolName, userRole]);

  // The URL carries which school's dashboard you're looking at:
  //   #shri-ram-academy/contacts
  // A platform admin isn't scoped to one school, so they get 'platform'.
  // This is the school's slug rather than its display name because a name
  // like "The Shri Ram Academy" would have to be percent-encoded in a URL.
  const schoolSlug = user?.school_slug || (userRole === 'admin' ? 'platform' : null);

  const allowedTabsFor = (role: string): Tab[] => {
    const tabs: Tab[] = ['dashboard', 'classes', 'counselors', 'counselor', 'campaigns', 'contacts', 'scheduling', 'insights'];
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
  // Set when a bucket on Call Insights is clicked; Contacts consumes it once
  // and clears it, so returning to the tab later doesn't re-apply the filter.
  const [jumpToClassification, setJumpToClassification] = useState<string | null>(null);

  const viewClassificationFromInsights = (label: string) => {
    setJumpToClassification(label);
    setActiveTab('contacts');
    window.location.hash = hashFor('contacts');
  };

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

  const showToast = React.useCallback((message: string, type: 'success' | 'error' = 'success') => {
    // Date.now() alone collides when two toasts fire in the same millisecond
    // (e.g. several pages erroring at once), producing duplicate React keys.
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  // Global Real-time Push (SSE) Toast Notifications
  useSSE(React.useCallback((msg) => {
    if (msg.event === 'APPOINTMENT_BOOKED') {
      const t = msg.data?.readable_time || 'upcoming slot';
      const purpose = msg.data?.purpose || 'Campus Visit';
      showToast(`🎉 New Appointment: ${purpose} on ${t}`, 'success');
    } else if (msg.event === 'CALLBACK_SCHEDULED') {
      const t = msg.data?.readable_time || 'upcoming slot';
      showToast(`📞 Callback scheduled for ${t}`, 'success');
    }
  }, []), ['APPOINTMENT_BOOKED', 'CALLBACK_SCHEDULED']);

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

  // The toast container has to render on the login screen too. It used to live
  // only inside the authenticated layout below, AFTER this early return — so
  // every message raised while signed out was created and then never displayed:
  // a wrong password, an unreachable server, Cognito not configured. The user
  // clicked and simply nothing happened.
  if (!token) {
    if (showLogin) {
      return (
        <>
          <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />
          <ToastStack toasts={toasts} />
        </>
      );
    }
    return <Landing onLoginClick={() => window.location.hash = '#login'} />;
  }

  const navItems: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: 'dashboard',  icon: <LayoutDashboard size={18} />, label: 'Overview' },
    { tab: 'counselor',  icon: <Headphones size={18} />,      label: 'Follow-ups' },
    { tab: 'campaigns',  icon: <BarChart2 size={18} />,       label: 'Campaigns' },
    { tab: 'contacts',   icon: <Users size={18} />,           label: 'Leads' },
    { tab: 'classes',    icon: <BookOpen size={18} />,        label: 'Classes' },
    { tab: 'scheduling', icon: <CalendarCheck size={18} />,   label: 'Scheduling' },
    { tab: 'insights',   icon: <TrendingUp size={18} />,      label: 'Reports' },
  ];

  if (userRole === 'admin') {
    navItems.push({ tab: 'schools',  icon: <SchoolIcon size={18} />,   label: 'Schools' });
    navItems.push({ tab: 'settings', icon: <SettingsIcon size={18} />, label: 'Settings' });
  }

  // User initials for avatar
  const userInitials = (() => {
    const name = user?.school_name || user?.email || 'U';
    return name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  })();

  return (
    <div className="app-container">
      {/* Global Top Header — Response AI style */}
      <header className="top-header">
        <div className="left-section">
          {/* Response AI brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="sidebar-brand-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="white"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.01em' }}>Response AI</div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 500 }}>Admissions CRM</div>
            </div>
          </div>
        </div>

        <div className="right-section">
          <div
            className="live-sync-pill"
            title="Real-Time Server-Sent Events (SSE) Live Stream Connected"
          >
            <span className="live-sync-dot" />
            Live Sync
          </div>

          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className="btn btn-secondary btn-icon"
            style={{ borderRadius: '8px', padding: '7px 9px' }}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={15} style={{ color: '#f59e0b' }} /> : <Moon size={15} style={{ color: '#6366f1' }} />}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: '12px', borderLeft: '1px solid var(--border-color)' }}>
            <div className="avatar-circle">{userInitials}</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {user?.school_name || (userRole === 'admin' ? 'Admin' : user?.email?.split('@')[0] || 'User')}
              </span>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                {userRole === 'admin' ? 'Platform Admin' : 'Admissions Staff'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="btn-icon"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '5px', borderRadius: '6px', display: 'flex', transition: 'var(--transition-smooth)' }}
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="main-layout">
        {/* Sidebar Navigation — Response AI CRM style */}
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>

          <div className="sidebar-inner">
            {/* Workspace info */}
            <div style={{ marginBottom: '8px' }}>
              <div className="sidebar-section-label">WORKSPACE</div>
              <div className="sidebar-school-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {schoolLogo && (
                  <img
                    src={schoolLogo.startsWith('http') ? schoolLogo : `http://localhost:5000${schoolLogo}`}
                    alt=""
                    style={{ width: '24px', height: '24px', objectFit: 'contain', flexShrink: 0, borderRadius: '4px' }}
                  />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {schoolName || (userRole === 'admin' ? 'Platform Admin' : '—')}
                </span>
              </div>
            </div>

            {/* Nav links */}
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

            {/* Bottom actions */}
            <div className="sidebar-bottom-actions">
              <button
                onClick={handleLogout}
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', fontSize: '0.82rem', padding: '8px 10px' }}
                title={sidebarCollapsed ? 'Sign Out' : undefined}
              >
                <LogOut size={15} style={{ flexShrink: 0 }} />
                <span className="nav-label">Sign Out</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content with smooth animated container */}
        <main className="main-content">
          <div key={activeTab} className="page-transition-enter">
            {activeTab === 'dashboard' && <Dashboard showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'counselors' && <CounselorQueue key="roster" initialWorkspace="roster" showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'counselor' && <CounselorQueue key="queue" initialWorkspace="queue" showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'campaigns' && <Campaigns showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'contacts' && <Contacts showToast={showToast} jumpToContactId={jumpToContactId} onJumpHandled={() => setJumpToContactId(null)} jumpToClassification={jumpToClassification} onClassificationHandled={() => setJumpToClassification(null)} />}
            {activeTab === 'classes' && <Classes showToast={showToast} />}
            {activeTab === 'scheduling' && <Scheduling showToast={showToast} />}
            {activeTab === 'insights' && <Insights showToast={showToast} onViewClassification={viewClassificationFromInsights} />}
            {activeTab === 'schools' && userRole === 'admin' && <Schools showToast={showToast} />}
            {activeTab === 'settings' && userRole === 'admin' && <Settings showToast={showToast} />}
          </div>
        </main>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
