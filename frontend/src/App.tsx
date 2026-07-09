import React, { useState } from 'react';
import Login from './pages/Login';
import Contacts from './pages/Contacts';
import Scheduling from './pages/Scheduling';
import Settings from './pages/Settings';
import Campaigns from './pages/Campaigns';
import Dashboard from './pages/Dashboard';
import {
  Users, Settings as SettingsIcon, LogOut, MessageSquare,
  BarChart2, CalendarCheck, Sun, Moon, LayoutDashboard,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
type Tab = 'dashboard' | 'campaigns' | 'contacts' | 'scheduling' | 'settings';

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
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

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      localStorage.setItem('sidebar_collapsed', prev ? '0' : '1');
      return !prev;
    });
  };

  const getRole = (): string => {
    if (!token) return 'user';
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.role || 'user';
    } catch (e) {
      return 'user';
    }
  };

  const userRole = getRole();

  const getInitialTab = (): Tab => {
    const hash = window.location.hash.slice(1) as Tab;
    const allowedTabs: Tab[] = ['dashboard', 'campaigns', 'contacts', 'scheduling'];
    if (userRole === 'admin') {
      allowedTabs.push('settings');
    }
    return allowedTabs.includes(hash) ? hash : 'dashboard';
  };
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab());
  const [jumpToContactId, setJumpToContactId] = useState<string | null>(null);

  const viewContactFromElsewhere = (contactId: string) => {
    setJumpToContactId(contactId);
    setActiveTab('contacts');
    window.location.hash = 'contacts';
  };

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) as Tab;
      const allowedTabs: Tab[] = ['dashboard', 'campaigns', 'contacts', 'scheduling'];
      if (userRole === 'admin') {
        allowedTabs.push('settings');
      }
      if (allowedTabs.includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [userRole]);

  React.useEffect(() => {
    if (activeTab === 'settings' && userRole !== 'admin') {
      setActiveTab('dashboard');
    }
  }, [activeTab, userRole]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const handleLoginSuccess = (userToken: string) => {
    localStorage.setItem('token', userToken);
    setToken(userToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    showToast('Logged out successfully', 'success');
  };

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />;
  }

  const navItems: { tab: Tab; icon: React.ReactNode; label: string }[] = [
    { tab: 'dashboard',    icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { tab: 'campaigns',    icon: <BarChart2 size={20} />,       label: 'Campaigns' },
    { tab: 'contacts',     icon: <Users size={20} />,           label: 'Leads Directory' },
    { tab: 'scheduling',   icon: <CalendarCheck size={20} />,   label: 'Scheduling' },
  ];

  if (userRole === 'admin') {
    navItems.push({ tab: 'settings', icon: <SettingsIcon size={20} />, label: 'System Settings' });
  }

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        <div className="logo-container">
          <MessageSquare style={{ color: 'var(--accent-primary)', flexShrink: 0 }} size={28} />
          <span className="logo-text">Call Manager</span>
        </div>

        <nav style={{ flexGrow: 1 }}>
          <ul className="nav-links">
            {navItems.map(({ tab, icon, label }) => (
              <li key={tab}>
                <a
                  href={`#${tab}`}
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

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
        {activeTab === 'dashboard'    && <Dashboard showToast={showToast} onViewContact={viewContactFromElsewhere} />}
        {activeTab === 'campaigns'    && <Campaigns showToast={showToast} onViewContact={viewContactFromElsewhere} />}
        {activeTab === 'contacts'     && <Contacts showToast={showToast} jumpToContactId={jumpToContactId} onJumpHandled={() => setJumpToContactId(null)} />}
        {activeTab === 'scheduling'   && <Scheduling showToast={showToast} />}
        {activeTab === 'settings'     && userRole === 'admin' && <Settings showToast={showToast} />}
      </main>

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
