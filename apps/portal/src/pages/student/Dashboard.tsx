import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.student.getDashboard().catch(() => null),
      api.student.getOnboardingStatus().catch(() => null)
    ])
      .then(([dashData, obData]) => {
        setData(dashData);
        setOnboarding(obData);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="spinner" style={{ width: 44, height: 44 }}></div>
      </div>
    );
  }

  // Mock schedule fallback data if backend returns empty during demo
  const currentClasses = data?.current_classes?.length > 0 ? data.current_classes : [
    { id: '1', code: 'BIB-101', name: 'Old Testament Survey', time: 'Mon/Wed 09:00 AM - 10:30 AM', room: 'Hall A1', credits: 3, grade: 'A' },
    { id: '2', code: 'THE-202', name: 'Systematic Theology I', time: 'Mon/Wed 11:00 AM - 12:30 PM', room: 'Hall B2', credits: 3, grade: 'A-' },
    { id: '3', code: 'HIS-301', name: 'Church History', time: 'Tue/Thu 02:00 PM - 03:30 PM', room: 'Hall C4', credits: 3, grade: 'B+' },
    { id: '4', code: 'MIN-405', name: 'Pastoral Leadership & Ethics', time: 'Friday 10:00 AM - 01:00 PM', room: 'Seminar 2', credits: 3, grade: 'IP' },
  ];

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      
      {/* ─── Hero Welcome Banner ─── */}
      <div className="hero-welcome">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
              ✦ BMI Academic Portal
            </div>
            <h1 style={{ fontSize: '2.25rem', color: 'white', marginBottom: '0.5rem', fontWeight: 900 }}>
              Welcome back, Student! 👋
            </h1>
            <p style={{ color: '#cbd5e1', fontSize: '0.95rem', maxWidth: 600, lineHeight: 1.5 }}>
              You are currently enrolled in the <strong>Biblical Studies & Leadership Program</strong>. Keep up the great work this semester!
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link to="/registration" className="btn btn-gold btn-sm" style={{ boxShadow: '0 4px 14px rgba(212, 175, 55, 0.4)' }}>
              📝 Course Registration
            </Link>
            <Link to="/student/finances" className="btn btn-outline btn-sm" style={{ borderColor: 'rgba(255, 255, 255, 0.4)', color: 'white' }}>
              💳 Pay Tuition
            </Link>
          </div>
        </div>
      </div>

      {/* ─── 4 KPI Stat Counter Cards ─── */}
      <div className="kpi-grid">
        <div className="kpi-card" style={{ borderTop: '4px solid var(--gold)' }}>
          <div className="kpi-lbl">Cumulative GPA</div>
          <div className="kpi-val" style={{ color: 'var(--navy)' }}>3.85 <span style={{ fontSize: '0.9rem', color: 'var(--slate)', fontWeight: 500 }}>/ 4.00</span></div>
          <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 700, marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            ▲ Dean's List Standing
          </div>
        </div>

        <div className="kpi-card" style={{ borderTop: '4px solid #3b82f6' }}>
          <div className="kpi-lbl">Degree Credit Progress</div>
          <div className="kpi-val">29 <span style={{ fontSize: '0.9rem', color: 'var(--slate)', fontWeight: 500 }}>/ 120 Cr</span></div>
          <div style={{ marginTop: '0.5rem', background: 'var(--border)', height: 6, borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: '24%', background: '#3b82f6', height: '100%' }} />
          </div>
        </div>

        <div className="kpi-card" style={{ borderTop: '4px solid #10b981' }}>
          <div className="kpi-lbl">Active Enrolled Classes</div>
          <div className="kpi-val" style={{ color: '#065f46' }}>{currentClasses.length} <span style={{ fontSize: '0.9rem', color: 'var(--slate)', fontWeight: 500 }}>Courses</span></div>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate)', fontWeight: 600, marginTop: '0.4rem' }}>
            12 Total Credit Hours
          </div>
        </div>

        <div className="kpi-card" style={{ borderTop: '4px solid var(--gold)' }}>
          <div className="kpi-lbl">Account Tuition Balance</div>
          <div className="kpi-val" style={{ color: data?.upcoming_invoices?.length > 0 ? 'var(--danger)' : 'var(--navy)' }}>
            ${data?.upcoming_invoices?.reduce((acc: number, curr: any) => acc + (curr.amount || 0), 0) || '0.00'}
          </div>
          <div style={{ fontSize: '0.75rem', color: data?.upcoming_invoices?.length > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700, marginTop: '0.4rem' }}>
            {data?.upcoming_invoices?.length > 0 ? '⚠️ Invoice Due Soon' : '✓ Good Standing'}
          </div>
        </div>
      </div>

      {/* ─── Onboarding Checklist Card (if incomplete) ─── */}
      {onboarding && !onboarding.isComplete && (
        <div className="card" style={{ marginBottom: '2rem', border: '2px solid var(--gold)', background: 'linear-gradient(to right, rgba(212, 175, 55, 0.05), rgba(212, 175, 55, 0.15))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.35rem', color: 'var(--navy)', marginBottom: '0.2rem' }}>🎓 Enrollment Onboarding Checklist</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Complete required tasks to finalize your active student profile.</p>
            </div>
            <span style={{ fontWeight: 800, color: 'var(--navy)', background: 'var(--gold)', padding: '4px 12px', borderRadius: '99px', fontSize: '0.85rem' }}>
              {onboarding.progress}% Completed
            </span>
          </div>

          <div style={{ display: 'grid', gap: '0.65rem' }}>
            {onboarding.tasks.map((task: any) => (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1.1rem', background: task.completed ? 'rgba(16, 185, 129, 0.08)' : 'white', border: `1px solid ${task.completed ? 'var(--success)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: task.completed ? 'var(--success)' : 'var(--border)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800 }}>
                    {task.completed ? '✓' : '•'}
                  </div>
                  <span style={{ fontWeight: task.completed ? 700 : 500, color: task.completed ? '#065f46' : 'var(--navy)', fontSize: '0.9rem' }}>
                    {task.title}
                  </span>
                </div>
                {!task.completed && (
                  <Link to={task.actionUrl} className="btn btn-gold btn-sm">Start Task</Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Grid Layout: Current Schedule & Quick Actions ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Today's Schedule Card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--navy)' }}>📅 Enrolled Classes & Timetable</h2>
            <Link to="/student/academics" style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold-dark)' }}>View Full Schedule →</Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {currentClasses.map((cls: any) => (
              <div key={cls.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ background: 'var(--navy)', color: 'var(--gold)', fontWeight: 800, padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'var(--font-heading)' }}>
                    {cls.code}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.95rem' }}>{cls.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--slate)', marginTop: '0.15rem' }}>
                      📍 {cls.room} • {cls.time}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="badge badge-accepted" style={{ fontSize: '0.75rem' }}>Grade: {cls.grade}</span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--slate)', marginTop: '0.2rem' }}>{cls.credits} Credits</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions & Support Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="card">
            <h2 style={{ fontSize: '1.15rem', color: 'var(--navy)', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              ⚡ Quick Actions Hub
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <Link to="/registration" className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }}>
                📝 Register for Classes
              </Link>
              <Link to="/student/finances" className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }}>
                💳 Pay Tuition & Fees
              </Link>
              <Link to="/student/documents" className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }}>
                📄 Request Transcript / ID
              </Link>
              <Link to="/student/support" className="btn btn-outline btn-sm" style={{ justifyContent: 'flex-start' }}>
                🎫 Contact Support Ticket
              </Link>
            </div>
          </div>

          <div className="card" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: 'white' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--gold)', marginBottom: '0.5rem' }}>👨‍🏫 Academic Advisor</h3>
            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>Dr. Samuel Vance, Ph.D.</div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem' }}>Department of Theological Studies</div>
            <Link to="/student/support" className="btn btn-gold btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
              Send Message
            </Link>
          </div>

        </div>

      </div>

    </div>
  );
}
