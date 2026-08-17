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
import VoiceProviders from './pages/VoiceProviders';
import Billing from './pages/Billing';
import Logs from './pages/Logs';
import Courses from './pages/Courses';
import Customization from './pages/Customization';
import AgentConfig from './pages/AgentConfig';
import { useSSE } from './hooks/useSSE';
import {
  Users, Settings as SettingsIcon, LogOut,
  BarChart2, CalendarCheck, Sun, Moon, LayoutDashboard,
  PanelLeftClose, PanelLeftOpen, School as SchoolIcon, TrendingUp, Headphones,
  Phone, FileText, ChevronRight, Radio, BookOpen, GraduationCap, CalendarDays,
  Layers, CreditCard, Terminal, Palette, Activity, Zap, Eye, ChevronDown, Check, Sparkles,
  Bot
} from 'lucide-react';

type Tab =
  | 'dashboard'
  | 'campaigns'
  | 'contacts'
  | 'classes'
  | 'courses'
  | 'counselor'
  | 'counselors'
  | 'scheduling'
  | 'insights'
  | 'providers'
  | 'agent_config'
  | 'billing'
  | 'logs'
  | 'customization'
  | 'settings'
  | 'schools';

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

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
  const [theme, setTheme] = useState<string>(
    localStorage.getItem('theme') || 'light'
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [activeVoiceProvider, setActiveVoiceProvider] = useState<string>('retell');
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
    setSidebarCollapsed(prev => !prev);
  };

  const [user, setUser] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });

  const [schoolsList, setSchoolsList] = useState<any[]>([]);
  const [showTenantDropdown, setShowTenantDropdown] = useState<boolean>(false);

  React.useEffect(() => {
    if (!token) return;
    api.get('/auth/me')
      .then(res => {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
      });

    api.get('/providers/active')
      .then(res => {
        if (res.data?.active_provider) {
          setActiveVoiceProvider(res.data.active_provider);
        }
      })
      .catch(() => {});

    // If admin or viewing as tenant, fetch schools for workspace switcher
    try {
      const savedUser = JSON.parse(localStorage.getItem('user') || '{}');
      if (savedUser?.role === 'admin' || localStorage.getItem('admin_token')) {
        api.get('/schools')
          .then(res => setSchoolsList(res.data || []))
          .catch(() => {});
      }
    } catch {}
  }, [token]);

  const userRole = user?.role || 'user';
  const isImpersonated = Boolean(user?.impersonated || localStorage.getItem('admin_token'));
  const schoolName = user?.school_name || null;
  const schoolSlug = user?.school_slug || null;
  const schoolLogo = user?.school_logo || null;

  const handleSwitchTenant = async (schoolId: string | null) => {
    setShowTenantDropdown(false);
    if (!schoolId) {
      // Exit impersonation, return to Master Admin
      const adminToken = localStorage.getItem('admin_token');
      if (adminToken) {
        localStorage.setItem('token', adminToken);
        localStorage.removeItem('admin_token');
      }
      localStorage.removeItem('user');
      window.location.hash = '#dashboard';
      window.location.reload();
      return;
    }

    try {
      const res = await api.post(`/schools/${schoolId}/view-as`);
      if (res.data?.token && res.data?.user) {
        if (!localStorage.getItem('admin_token')) {
          localStorage.setItem('admin_token', token || '');
        }
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        window.location.hash = '#dashboard';
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to switch tenant', err);
    }
  };

  React.useEffect(() => {
    if (schoolName) {
      document.title = `${schoolName} Portal - Response AI`;
    } else if (userRole === 'admin') {
      document.title = `Admin Console - Response AI`;
    } else {
      document.title = 'Response AI | Admissions CRM';
    }
  }, [schoolName, userRole]);

  const allowedTabsFor = (role: string): Tab[] => {
    const tabs: Tab[] = [
      'dashboard', 'classes', 'courses', 'counselor', 'campaigns',
      'contacts', 'scheduling', 'insights', 'billing', 'agent_config', 'customization'
    ];
    if (role === 'admin') {
      tabs.push('providers', 'logs', 'settings', 'schools');
    }
    return tabs;
  };

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

  React.useEffect(() => {
    if (!token || !user) return;
    const desired = hashFor(activeTab);
    if (window.location.hash !== desired) {
      window.location.replace(desired);
    }
  }, [token, user, activeTab, schoolSlug]);

  const [jumpToContactId, setJumpToContactId] = useState<string | null>(null);
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
    if ((activeTab === 'settings' || activeTab === 'schools' || activeTab === 'providers' || activeTab === 'logs') && userRole !== 'admin') {
      setActiveTab('dashboard');
    }
  }, [activeTab, userRole]);

  const showToast = React.useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

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

  // Response AI SaaS Grouped Navigation Model
  const navSections: {
    sectionTitle: string;
    items: { tab: Tab; icon: React.ReactNode; label: string }[];
  }[] = [
    {
      sectionTitle: 'OPERATE',
      items: [
        { tab: 'dashboard', icon: <LayoutDashboard size={17} />, label: 'Overview' },
        { tab: 'campaigns', icon: <BarChart2 size={17} />, label: 'Campaigns' },
        { tab: 'contacts', icon: <Users size={17} />, label: 'Admission Leads' },
        { tab: 'classes', icon: <BookOpen size={17} />, label: 'Classes & Batches' },
        { tab: 'courses', icon: <GraduationCap size={17} />, label: 'Academic Programs' }
      ]
    },
    {
      sectionTitle: 'COUNSELING',
      items: [
        { tab: 'counselor', icon: <Headphones size={17} />, label: 'Follow-ups Queue' },
        { tab: 'scheduling', icon: <CalendarCheck size={17} />, label: 'Appointments' }
      ]
    },
    {
      sectionTitle: 'MONITOR',
      items: [
        { tab: 'insights', icon: <TrendingUp size={17} />, label: 'Call Insights' },
        ...(userRole === 'admin' ? [
          { tab: 'logs' as Tab, icon: <Terminal size={17} />, label: 'System Logs' }
        ] : [])
      ]
    },
    {
      sectionTitle: 'MANAGE',
      items: [
        { tab: 'agent_config' as Tab, icon: <Bot size={17} />, label: 'AI Agent Studio' },
        // { tab: 'providers' as Tab, icon: <Layers size={17} />, label: 'Voice & Providers' },
        { tab: 'billing', icon: <CreditCard size={17} />, label: 'Usage & Billing' },
        ...(userRole === 'admin' ? [
          { tab: 'settings' as Tab, icon: <SettingsIcon size={17} />, label: 'Organization & System' }
        ] : [])
      ]
    }
  ];

  const userInitials = (() => {
    const name = user?.school_name || user?.email || 'U';
    return name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  })();

  return (
    <div className="app-container">
      {/* Impersonation Tenant Banner */}
      {isImpersonated && (
        <div style={{
          background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
          color: '#fff',
          padding: '8px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.84rem',
          fontWeight: 600,
          boxShadow: '0 2px 10px rgba(245,158,11,0.3)',
          zIndex: 9999
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Eye size={16} />
            <span>Viewing Tenant Portal as: <strong>{schoolName || 'School Client'}</strong> (Tenant Scoped View)</span>
          </div>
          <button
            onClick={() => handleSwitchTenant(null)}
            style={{
              background: '#fff',
              color: '#b45309',
              border: 'none',
              padding: '4px 14px',
              borderRadius: '6px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '0.78rem',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            Exit Tenant View &amp; Return to Master Admin
          </button>
        </div>
      )}

      {/* Top Header — Response AI Admissions CRM */}
      <header className="top-header">
        <div className="left-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={toggleSidebar}
              className="btn btn-secondary btn-icon"
              style={{ borderRadius: '8px', padding: '6px 8px', border: '1px solid var(--border-color)' }}
              title={sidebarCollapsed ? 'Expand Sidebar (Show all pages)' : 'Collapse Sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} color="var(--text-primary)" /> : <PanelLeftClose size={16} color="var(--text-primary)" />}
            </button>
            <img
              src="/logo.png"
              alt="Response AI"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                objectFit: 'cover',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)'
              }}
            />
            <div>
              <div style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.01em', fontFamily: 'var(--font-display)' }}>
                Response AI
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 600 }}>
                Admissions CRM
              </div>
            </div>
          </div>
        </div>

        <div className="right-section" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Active Engine Status Badge */}
          <div style={{
            background: 'rgba(16,185,129,0.10)',
            border: '1px solid rgba(16,185,129,0.25)',
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '0.74rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--accent-primary)'
          }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }} className="animate-pulse" />
            {userRole === 'admin'
              ? `${activeVoiceProvider === 'retell' ? 'Retell AI' : activeVoiceProvider === 'omnidimension' ? 'OmniDimension AI' : 'Bolna AI'} Active`
              : 'Neural Voice Engine Online'}
          </div>

          <div
            className="live-sync-pill"
            title="Real-Time Server-Sent Events (SSE) Live Stream Connected"
          >
            <span className="live-sync-dot" />
            Live Sync
          </div>

          {/* Quick Theme Toggle */}
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
        {/* Retell SaaS Persistent Sidebar */}
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-inner">
            {/* School / Tenant Switcher */}
            <div style={{ marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
              <div className="sidebar-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>WORKSPACE</span>
                {(userRole === 'admin' || isImpersonated) && (
                  <span style={{ fontSize: '0.64rem', color: 'var(--accent-primary)', fontWeight: 700 }}>MULTI-TENANT</span>
                )}
              </div>
              <div
                onClick={() => (userRole === 'admin' || isImpersonated) && setShowTenantDropdown(prev => !prev)}
                className="sidebar-school-name"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  cursor: (userRole === 'admin' || isImpersonated) ? 'pointer' : 'default',
                  padding: '6px 8px',
                  borderRadius: '8px',
                  background: showTenantDropdown ? 'var(--bg-tertiary)' : 'transparent',
                  transition: 'var(--transition-smooth)'
                }}
                title={userRole === 'admin' || isImpersonated ? 'Click to switch tenant workspace' : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  {schoolLogo ? (
                    <img
                      src={schoolLogo.startsWith('http') ? schoolLogo : `http://localhost:5000${schoolLogo}`}
                      alt=""
                      style={{ width: '22px', height: '22px', objectFit: 'contain', flexShrink: 0, borderRadius: '4px' }}
                    />
                  ) : (
                    <SchoolIcon size={16} color={isImpersonated ? '#f59e0b' : 'var(--accent-primary)'} />
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700, fontSize: '0.88rem' }}>
                    {schoolName || (userRole === 'admin' ? 'Platform Master' : '—')}
                  </span>
                </div>
                {(userRole === 'admin' || isImpersonated) && (
                  <ChevronDown size={14} color="var(--text-muted)" style={{ transform: showTenantDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                )}
              </div>

              {/* Workspace Switcher Dropdown */}
              {showTenantDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: '0',
                  right: '0',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  marginTop: '4px',
                  padding: '6px',
                  maxHeight: '260px',
                  overflowY: 'auto'
                }}>
                  <div
                    onClick={() => handleSwitchTenant(null)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                      fontWeight: !isImpersonated ? 700 : 500,
                      background: !isImpersonated ? 'rgba(16,185,129,0.1)' : 'transparent',
                      color: !isImpersonated ? 'var(--accent-primary)' : 'var(--text-primary)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={14} color="var(--accent-primary)" />
                      <span>Platform Master (All Schools)</span>
                    </div>
                    {!isImpersonated && <Check size={14} color="var(--accent-primary)" />}
                  </div>

                  {schoolsList.map(s => {
                    const isCurrent = user?.school_id === s.id;
                    return (
                      <div
                        key={s.id}
                        onClick={() => handleSwitchTenant(s.id)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '0.82rem',
                          fontWeight: isCurrent ? 700 : 500,
                          background: isCurrent ? 'rgba(245,158,11,0.12)' : 'transparent',
                          color: isCurrent ? '#d97706' : 'var(--text-primary)',
                          marginTop: '2px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <SchoolIcon size={14} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        </div>
                        {isCurrent && <Check size={14} color="#d97706" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Categorized Nav Links */}
            <nav style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {navSections.map((sec) => (
                <div key={sec.sectionTitle}>
                  {!sidebarCollapsed && (
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '4px 10px 6px', textTransform: 'uppercase' }}>
                      {sec.sectionTitle}
                    </div>
                  )}
                  <ul className="nav-links">
                    {sec.items.map(({ tab, icon, label }) => (
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
                </div>
              ))}
            </nav>

            {/* Bottom Concurrency Meter & Actions */}
            <div className="sidebar-bottom-actions" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {!sidebarCollapsed && (
                <div style={{
                  background: 'var(--bg-tertiary)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  fontSize: '0.76rem',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-muted)' }}>
                    <span>Active Concurrency</span>
                    <strong style={{ color: 'var(--accent-success)' }}>8 / 20</strong>
                  </div>
                  <div style={{ height: '5px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: '40%', height: '100%', background: 'var(--accent-gradient)', borderRadius: '4px' }} />
                  </div>
                </div>
              )}

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

        {/* Main Content Pane */}
        <main className="main-content">
          <div key={activeTab} className="page-transition-enter">
            {activeTab === 'dashboard' && <Dashboard showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'counselors' && <CounselorQueue key="roster" initialWorkspace="roster" showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'counselor' && <CounselorQueue key="queue" initialWorkspace="queue" showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'campaigns' && <Campaigns showToast={showToast} onViewContact={viewContactFromElsewhere} />}
            {activeTab === 'contacts' && <Contacts showToast={showToast} jumpToContactId={jumpToContactId} onJumpHandled={() => setJumpToContactId(null)} jumpToClassification={jumpToClassification} onClassificationHandled={() => setJumpToClassification(null)} />}
            {activeTab === 'classes' && <Classes showToast={showToast} />}
            {activeTab === 'courses' && <Courses showToast={showToast} />}
            {activeTab === 'scheduling' && <Scheduling showToast={showToast} />}
            {activeTab === 'insights' && <Insights showToast={showToast} onViewClassification={viewClassificationFromInsights} />}
            {activeTab === 'providers' && <VoiceProviders showToast={showToast} onProviderChanged={(p) => setActiveVoiceProvider(p)} />}
            {activeTab === 'agent_config' && <AgentConfig showToast={showToast} />}
            {activeTab === 'billing' && <Billing showToast={showToast} />}
            {activeTab === 'logs' && userRole === 'admin' && <Logs showToast={showToast} />}
            {(activeTab === 'settings' || activeTab === 'schools' || activeTab === 'customization') && userRole === 'admin' && (
              <Settings
                showToast={showToast}
                currentTheme={theme}
                onThemeChange={(newTheme) => setTheme(newTheme)}
                initialTab={activeTab === 'schools' ? 'schools' : activeTab === 'customization' ? 'appearance' : 'schools'}
              />
            )}
          </div>
        </main>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}
