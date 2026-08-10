import React from 'react';
import { MessageSquare, Phone, CalendarCheck, Shield, ChevronRight, LayoutDashboard, BrainCircuit, Globe, Zap } from 'lucide-react';

interface LandingProps {
  onLoginClick: () => void;
}

export default function Landing({ onLoginClick }: LandingProps) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      backgroundImage: 'radial-gradient(circle at 15% 50%, rgba(99, 102, 241, 0.08), transparent 25%), radial-gradient(circle at 85% 30%, rgba(79, 70, 229, 0.08), transparent 25%)',
      fontFamily: "'Inter', sans-serif",
      color: 'var(--text-primary)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <header style={{
        padding: '24px 48px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            padding: '10px',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 15px rgba(59, 130, 246, 0.25)'
          }}>
            <MessageSquare style={{ color: '#fff' }} size={24} />
          </div>
          <span style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em' }}>EnquiryCall</span>
        </div>

        <button 
          onClick={onLoginClick}
          className="btn btn-primary" 
          style={{ 
            padding: '10px 24px', 
            borderRadius: '50px', 
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          Login to Console <ChevronRight size={18} />
        </button>
      </header>

      {/* Hero Section */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <section style={{
          padding: '100px 24px',
          textAlign: 'center',
          maxWidth: '900px',
          margin: '0 auto',
          position: 'relative'
        }}>
          {/* Subtle glowing orb behind hero */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '600px',
            height: '600px',
            background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(255,255,255,0) 70%)',
            zIndex: 0,
            pointerEvents: 'none'
          }}></div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '6px 16px', 
              background: 'rgba(99, 102, 241, 0.1)', 
              color: 'var(--accent-primary)',
              borderRadius: '50px',
              fontWeight: 600,
              fontSize: '0.9rem',
              marginBottom: '24px',
              border: '1px solid rgba(99, 102, 241, 0.2)'
            }}>
              <Zap size={14} /> Powering Next-Gen Admissions
            </div>
            
            <h1 style={{ 
              fontSize: '4.5rem', 
              fontWeight: 900, 
              lineHeight: 1.1, 
              letterSpacing: '-0.03em',
              marginBottom: '24px',
              background: 'linear-gradient(135deg, var(--text-primary) 30%, var(--accent-primary) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Transform Admissions with AI Voice Agents
            </h1>
            
            <p style={{ 
              fontSize: '1.25rem', 
              color: 'var(--text-secondary)', 
              lineHeight: 1.6, 
              maxWidth: '700px', 
              margin: '0 auto 40px auto' 
            }}>
              The most advanced human-like voice AI built specifically for educational institutions. Automate follow-ups, handle inquiries, and schedule campus tours effortlessly 24/7.
            </p>
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
              <button 
                onClick={onLoginClick}
                className="btn btn-primary"
                style={{ 
                  padding: '16px 36px', 
                  fontSize: '1.1rem', 
                  borderRadius: '50px',
                  boxShadow: '0 10px 25px rgba(79, 70, 229, 0.3)'
                }}
              >
                Access Platform
              </button>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section style={{
          padding: '80px 24px 120px 24px',
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '30px'
        }}>
          {[
            {
              icon: <BrainCircuit size={28} />,
              title: "Human-like AI Voice",
              desc: "Ultra-realistic conversational AI that understands context, handles interruptions, and sounds indistinguishable from human counselors.",
              color: "#6366f1"
            },
            {
              icon: <CalendarCheck size={28} />,
              title: "Automated Scheduling",
              desc: "Seamlessly schedules callback times for interested leads instantly during calls, syncing them with counselor follow-up queues.",
              color: "#10b981"
            },
            {
              icon: <LayoutDashboard size={28} />,
              title: "Centralized CRM",
              desc: "Manage leads, view rich call transcripts, and track admission campaign performance across all your school branches in one dashboard.",
              color: "#f59e0b"
            },
            {
              icon: <Globe size={28} />,
              title: "Multi-School Tenancy",
              desc: "Perfect for education groups. Manage multiple campuses securely, each with their own knowledge base, calendar, and dedicated agent.",
              color: "#7c3aed"
            }
          ].map((feat, idx) => (
            <div key={idx} className="glass-panel hover-lift" style={{ 
              padding: '32px',
              transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              cursor: 'default'
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: `${feat.color}15`,
                color: feat.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px'
              }}>
                {feat.icon}
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '12px' }}>{feat.title}</h3>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{feat.desc}</p>
            </div>
          ))}
        </section>
      </main>

      {/* Footer */}
      <footer style={{
        padding: '40px',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-tertiary)'
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          &copy; {new Date().getFullYear()} EnquiryCall. All rights reserved.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Delivered by</span>
          <img src="/ri-logo.png" alt="Response Informatics" style={{ height: '32px', opacity: 0.8 }} />
        </div>
      </footer>
    </div>
  );
}
