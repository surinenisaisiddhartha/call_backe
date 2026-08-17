import React, { useState } from 'react';
import {
  PhoneCall, Shield, ChevronRight, Zap, Radio, CheckCircle2,
  Calendar, Layers, Sparkles, Activity, Play, Pause, Bot, ArrowRight,
  TrendingUp, Award, Clock, DollarSign, Users, Globe
} from 'lucide-react';

interface LandingProps {
  onLoginClick: () => void;
}

export default function Landing({ onLoginClick }: LandingProps) {
  const [simCalling, setSimCalling] = useState(false);
  const [simStep, setSimStep] = useState(0);

  const demoScript = [
    { speaker: 'Parent', text: 'Hello! I am inquiring about Grade 6 admissions for my child. Can you share fee details and curriculum?' },
    { speaker: 'AI Agent', text: 'Namaste! We offer the comprehensive IB Middle Years Programme (MYP). Our annual tuition is ₹3.2 Lakhs with world-class robotics labs and sports facilities. Would you like a campus tour or a 1-on-1 virtual video consultation with our counselor?' },
    { speaker: 'Parent', text: 'How does your school compare with other international schools in the area?' },
    { speaker: 'AI Agent', text: 'Great question! We maintain an exclusive 1:8 student-teacher ratio with 100% IB Diploma pass rates, international university placement mentoring, and state-of-the-art experiential STEM labs.' }
  ];

  const handleToggleSim = () => {
    if (simCalling) {
      setSimCalling(false);
      setSimStep(0);
    } else {
      setSimCalling(true);
      setSimStep(0);
      let step = 0;
      const interval = setInterval(() => {
        step += 1;
        if (step < demoScript.length) {
          setSimStep(step);
        } else {
          clearInterval(interval);
        }
      }, 3200);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Navigation Header */}
      <header style={{
        padding: '18px 48px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img
            src="/logo.png"
            alt="Response AI"
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              objectFit: 'cover',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15)'
            }}
          />
          <div>
            <span style={{ fontSize: '1.3rem', fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Response AI
            </span>
            <span style={{ fontSize: '0.72rem', marginLeft: '8px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--accent-primary)', fontWeight: 700 }}>
              ADMISSIONS CRM
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button
            onClick={onLoginClick}
            className="btn-primary"
            style={{ padding: '9px 22px', borderRadius: '50px', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            Sign In to Console <ChevronRight size={16} />
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <main style={{ flex: 1 }}>
        <section style={{ padding: '72px 24px 40px', textAlign: 'center', maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            background: 'rgba(16, 185, 129, 0.1)',
            color: 'var(--accent-primary)',
            borderRadius: '50px',
            fontWeight: 700,
            fontSize: '0.82rem',
            marginBottom: '20px'
          }}>
            <Sparkles size={14} /> Enterprise AI Admission Voice Operating Platform
          </div>

          <h1 style={{
            fontSize: '3.2rem',
            fontWeight: 800,
            fontFamily: 'var(--font-display)',
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            color: 'var(--text-primary)',
            marginBottom: '20px'
          }}>
            High-Definition AI Voice & Admissions CRM for Modern Institutions
          </h1>

          <p style={{
            fontSize: '1.15rem',
            color: 'var(--text-secondary)',
            maxWidth: '780px',
            margin: '0 auto 36px',
            lineHeight: 1.55
          }}>
            Multi-client admissions CRM for schools and universities running AI-powered outbound admission calls. Qualify leads instantly, articulate school USPs, and sync virtual video consultations directly with counselor queues.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '56px' }}>
            <button
              onClick={onLoginClick}
              className="btn-primary hover-lift"
              style={{ padding: '14px 32px', borderRadius: '50px', fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              Launch Admissions Console <ArrowRight size={18} />
            </button>
          </div>

          {/* Interactive Voice Simulator Box (100% White-Labeled) */}
          <div className="card hover-lift" style={{
            borderRadius: '20px',
            padding: '28px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-lg)',
            textAlign: 'left',
            maxWidth: '840px',
            margin: '0 auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: simCalling ? '#22c55e' : '#94a3b8' }} className={simCalling ? 'animate-pulse' : ''} />
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  Interactive Voice Admission Simulation
                </span>
              </div>

              <div style={{ fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--accent-primary)', padding: '4px 10px', borderRadius: '8px', fontWeight: 600 }}>
                ● Neural Voice Engine Active
              </div>
            </div>

            {/* Conversation Stream */}
            <div style={{
              background: 'var(--bg-tertiary)',
              borderRadius: '12px',
              padding: '20px',
              minHeight: '180px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              marginBottom: '18px'
            }}>
              {!simCalling ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: 'auto' }}>
                  <Bot size={28} style={{ marginBottom: '8px', opacity: 0.6 }} />
                  <div>Click "Start AI Simulation" to see live lead qualification and school comparison in action.</div>
                </div>
              ) : (
                demoScript.slice(0, simStep + 1).map((msg, idx) => (
                  <div
                    key={idx}
                    className="animate-fade-in"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: msg.speaker === 'Parent' ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                      {msg.speaker === 'AI Agent' ? 'Response AI Admission Assistant' : 'Prospective Parent'}
                    </span>
                    <div style={{
                      padding: '10px 16px',
                      borderRadius: '12px',
                      maxWidth: '85%',
                      fontSize: '0.88rem',
                      lineHeight: 1.45,
                      background: msg.speaker === 'Parent' ? 'var(--accent-gradient)' : 'var(--bg-card)',
                      color: msg.speaker === 'Parent' ? '#fff' : 'var(--text-primary)',
                      border: msg.speaker === 'AI Agent' ? '1px solid var(--border-color)' : 'none',
                      boxShadow: 'var(--shadow-sm)'
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={handleToggleSim}
                className="btn-primary"
                style={{ padding: '8px 18px', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {simCalling ? <Pause size={14} /> : <Play size={14} />}
                {simCalling ? 'Stop Simulation' : 'Start AI Simulation'}
              </button>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Speech Latency: <strong>&lt; 380ms</strong> | Telephony: <strong>Carrier Grade SIP</strong>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <section style={{ padding: '60px 24px', maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
            <div className="card hover-lift" style={{ padding: '28px', borderRadius: '16px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.12)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <Layers size={22} />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                Multi-Channel Voice Engine
              </h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Ultra-low latency conversational AI engine designed specifically for educational admissions qualification and high concurrency dialing.
              </p>
            </div>

            <div className="card hover-lift" style={{ padding: '28px', borderRadius: '16px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(6,182,212,0.12)', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <DollarSign size={22} />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                Transparent Usage Analytics
              </h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Real-time per-minute call cost calculation, itemized billing breakdowns, and automated statement generation.
              </p>
            </div>

            <div className="card hover-lift" style={{ padding: '28px', borderRadius: '16px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(99,102,241,0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <Calendar size={22} />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                Virtual Video Consultations
              </h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Automated 1-on-1 virtual video appointment booking synchronized directly into counselor queues with 1-click video call join rooms.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer style={{
        padding: '24px 48px',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.84rem',
        color: 'var(--text-muted)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/logo.png" alt="Response AI" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} />
          <span>Product Delivered by <strong>Response Informatics</strong> · Response AI Admissions CRM</span>
        </div>
        <div style={{ display: 'flex', gap: '20px' }}>
          <span>AES-256 Encrypted</span>
          <span>99.99% Uptime</span>
          <span>SOC-2 Compliant</span>
        </div>
      </footer>
    </div>
  );
}
