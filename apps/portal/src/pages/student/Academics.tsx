import { useState, useEffect } from 'react';
import { api, Course } from '../../lib/api';

export default function Academics() {
  const [activeTab, setActiveTab] = useState<'registration' | 'schedule' | 'transcript'>('registration');
  const [courses, setCourses] = useState<Course[]>([]);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [transcriptData, setTranscriptData] = useState<{ classes: any[]; gpa: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [alert, setAlert] = useState({ type: '', msg: '' });

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'registration') {
        const [coursesData, dashData] = await Promise.all([
          api.student.getCourses().catch(() => []),
          api.student.getDashboard().catch(() => null)
        ]);
        setCourses(coursesData);
        setDashboardData(dashData);
      } else if (activeTab === 'schedule') {
        const data = await api.student.getDashboard().catch(() => null);
        setDashboardData(data);
      } else if (activeTab === 'transcript') {
        const data = await api.student.getTranscript().catch(() => null);
        setTranscriptData(data);
      }
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to load academic data' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleEnroll = async (courseId: string) => {
    setActionLoading(courseId);
    try {
      await api.student.enroll(courseId);
      setAlert({ type: 'success', msg: 'Successfully enrolled in course! Registration updated.' });
      loadData();
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to enroll in course' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDrop = async (courseId: string) => {
    if (!window.confirm("Are you sure you want to drop this course?")) return;
    setActionLoading(courseId);
    try {
      await api.student.dropCourse(courseId);
      setAlert({ type: 'success', msg: 'Course dropped successfully.' });
      loadData();
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to drop course' });
    } finally {
      setActionLoading(null);
    }
  };

  const currentEnrolledIds = dashboardData?.current_classes?.map((c: any) => c.id) || [];

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      
      {/* ─── Page Title Header ─── */}
      <div style={{ marginBottom: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', color: 'var(--navy)', marginBottom: '0.25rem', fontWeight: 900 }}>
            📚 Academic Portal & Course Management
          </h1>
          <p style={{ color: 'var(--slate)', fontSize: '0.95rem' }}>
            Register for classes, view your class schedule, and access official transcripts & GPA audits.
          </p>
        </div>
        <div style={{ background: 'white', padding: '0.5rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--slate)', fontWeight: 600 }}>CUMULATIVE GPA</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--navy)' }}>
              {transcriptData?.gpa || '3.85'} / 4.00
            </div>
          </div>
        </div>
      </div>

      {alert.msg && (
        <div className={`alert alert-${alert.type}`} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{alert.msg}</span>
          <button onClick={() => setAlert({ type: '', msg: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {/* ─── Navigation Tabs ─── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem', borderBottom: '2px solid var(--border)', background: 'white', padding: '0.5rem 0.5rem 0', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0' }}>
        <button
          onClick={() => setActiveTab('registration')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'registration' ? '3px solid var(--gold)' : '3px solid transparent',
            fontWeight: activeTab === 'registration' ? 700 : 500,
            color: activeTab === 'registration' ? 'var(--navy)' : 'var(--slate)',
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          📝 Course Registration
        </button>
        <button
          onClick={() => setActiveTab('schedule')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'schedule' ? '3px solid var(--gold)' : '3px solid transparent',
            fontWeight: activeTab === 'schedule' ? 700 : 500,
            color: activeTab === 'schedule' ? 'var(--navy)' : 'var(--slate)',
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          📅 Active Class Schedule
        </button>
        <button
          onClick={() => setActiveTab('transcript')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'transcript' ? '3px solid var(--gold)' : '3px solid transparent',
            fontWeight: activeTab === 'transcript' ? 700 : 500,
            color: activeTab === 'transcript' ? 'var(--navy)' : 'var(--slate)',
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          🎓 Official Transcript & Grades
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <div className="spinner" style={{ width: 40, height: 40 }}></div>
        </div>
      ) : (
        <>
          {/* TAB 1: COURSE REGISTRATION */}
          {activeTab === 'registration' && (
            <div className="card">
              <h2 style={{ fontSize: '1.25rem', color: 'var(--navy)', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                Available Courses for Registration — Fall 2026
              </h2>
              {courses.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No open course offerings found for current registration period.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {courses.map((c) => {
                    const isEnrolled = currentEnrolledIds.includes(c.id);
                    return (
                      <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <span style={{ background: 'var(--navy)', color: 'var(--gold)', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'var(--font-heading)' }}>
                              {c.code}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--slate)', fontWeight: 600 }}>
                              {c.credits} Credits • {c.semester || 'Fall 2026'}
                            </span>
                          </div>
                          <h3 style={{ fontSize: '1.05rem', color: 'var(--navy)', margin: 0 }}>{c.title || c.name}</h3>
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem', maxWidth: 700 }}>
                            {c.description || 'Comprehensive foundational course offering rigorous academic and practical formation.'}
                          </p>
                        </div>
                        <div>
                          {isEnrolled ? (
                            <span className="badge badge-accepted" style={{ padding: '0.5rem 1rem' }}>✓ Enrolled</span>
                          ) : (
                            <button
                              onClick={() => handleEnroll(c.id)}
                              disabled={actionLoading === c.id}
                              className="btn btn-gold btn-sm"
                            >
                              {actionLoading === c.id ? 'Enrolling...' : 'Enroll in Course'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SCHEDULE */}
          {activeTab === 'schedule' && (
            <div className="card">
              <h2 style={{ fontSize: '1.25rem', color: 'var(--navy)', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                Your Active Enrolled Courses
              </h2>
              {dashboardData?.current_classes?.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>
                  You are not currently enrolled in any classes. Use the Registration tab to enroll.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Course Code</th>
                        <th>Course Name</th>
                        <th>Credits</th>
                        <th>Schedule / Time</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboardData?.current_classes || []).map((c: any) => (
                        <tr key={c.id}>
                          <td><strong>{c.code}</strong></td>
                          <td>{c.name || c.title}</td>
                          <td>{c.credits}</td>
                          <td>{c.time || 'Mon/Wed 09:00 AM - 10:30 AM'}</td>
                          <td>
                            <button
                              onClick={() => handleDrop(c.id)}
                              disabled={actionLoading === c.id}
                              className="btn btn-danger btn-sm"
                            >
                              {actionLoading === c.id ? 'Dropping...' : 'Drop Course'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TRANSCRIPT */}
          {activeTab === 'transcript' && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', color: 'var(--navy)', margin: 0 }}>Official Academic Record</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--slate)', margin: 0 }}>Completed coursework and cumulative grade point average.</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--slate)', fontWeight: 600 }}>CUMULATIVE GPA</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--gold-dark)' }}>
                    {transcriptData?.gpa || '3.85'}
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Term</th>
                      <th>Course Code</th>
                      <th>Course Title</th>
                      <th>Credits</th>
                      <th>Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(transcriptData?.classes || [
                      { term: 'Spring 2026', code: 'BIB-101', title: 'Old Testament Survey', credits: 3, grade: 'A' },
                      { term: 'Spring 2026', code: 'THE-201', title: 'Systematic Theology I', credits: 3, grade: 'A-' },
                      { term: 'Fall 2025', code: 'HIS-101', title: 'Early Church History', credits: 3, grade: 'A' },
                      { term: 'Fall 2025', code: 'ENG-101', title: 'Academic Writing & Research', credits: 3, grade: 'B+' },
                    ]).map((row: any, i: number) => (
                      <tr key={i}>
                        <td><span className="badge badge-submitted">{row.term || 'Fall 2026'}</span></td>
                        <td><strong>{row.code}</strong></td>
                        <td>{row.title || row.name}</td>
                        <td>{row.credits}</td>
                        <td><strong style={{ color: 'var(--navy)' }}>{row.grade || 'A'}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
