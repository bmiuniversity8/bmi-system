import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';

export default function Documents() {
  const { user: authUser } = useAuth();
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [idCardFlipped, setIdCardFlipped] = useState(false);
  const [activeModal, setActiveModal] = useState<'admission' | 'verification' | null>(null);

  useEffect(() => {
    api.student.getDashboard().then(data => setDashboardData(data)).catch(() => {});
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, docType: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be under 10MB');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await api.student.uploadDocument(docType, file);
      setSuccess(`Successfully uploaded ${docType.replace('_', ' ')}! Your record has been updated.`);
      setTimeout(() => window.location.href = '/student/dashboard', 1500);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to upload document');
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const rawFirstName = authUser?.first_name || dashboardData?.user?.first_name || dashboardData?.first_name || '';
  const rawLastName = authUser?.last_name || dashboardData?.user?.last_name || dashboardData?.last_name || '';
  const studentName = (rawFirstName || rawLastName) ? `${rawFirstName} ${rawLastName}`.trim() : (authUser?.email ? authUser.email.split('@')[0] : 'Enrolled Student');
  const programName = dashboardData?.program_name || dashboardData?.user?.program_name || 'Bachelor of Science in Biblical Studies';
  const studentIdNumber = (dashboardData?.id || authUser?.id || 'BMI-2026-8801').substring(0, 12).toUpperCase();

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      
      {/* ─── Page Title Header ─── */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2rem', color: 'var(--navy)', marginBottom: '0.25rem', fontWeight: 900 }}>
          📁 Student Document Hub & Digital Credentials
        </h1>
        <p style={{ color: 'var(--slate)', fontSize: '0.95rem' }}>
          Upload identity credentials, view your digital student ID card, and download official verification letters.
        </p>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {success && (
        <div className="alert alert-success" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {/* ─── Digital Student ID Card Section ─── */}
      <div className="card" style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ✦ OFFICIAL DIGITAL STUDENT IDENTITY
            </div>
            <h2 style={{ fontSize: '1.35rem', color: 'white', margin: '0.2rem 0 0 0' }}>Digital Student Identification Card</h2>
          </div>
          <button
            className="btn btn-gold btn-sm"
            onClick={() => setIdCardFlipped(!idCardFlipped)}
            style={{ fontWeight: 700 }}
          >
            {idCardFlipped ? '🔄 View Card Front' : '🔄 Flip to Card Back'}
          </button>
        </div>

        {/* Realistic Card Container */}
        <div style={{ maxWidth: 440, margin: '0 auto', background: !idCardFlipped ? 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)' : '#0f172a', borderRadius: 16, padding: '1.75rem', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', border: '2px solid var(--gold)', position: 'relative', overflow: 'hidden' }}>
          {/* Subtle gold accent watermark */}
          <div style={{ position: 'absolute', right: -20, bottom: -20, opacity: 0.08, fontSize: '12rem', pointerEvents: 'none', userSelect: 'none' }}>
            🏛️
          </div>

          {!idCardFlipped ? (
            <div>
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <img src="/bmi-logo.png" alt="BMI" style={{ height: 26, width: 'auto', background: 'white', padding: '2px 4px', borderRadius: 4 }} />
                  <span style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--gold)', letterSpacing: '0.05em' }}>BMI UNIVERSITY</span>
                </div>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, background: 'var(--gold)', color: 'var(--navy)', padding: '2px 8px', borderRadius: 99 }}>STUDENT</span>
              </div>

              {/* Photo and Details Grid */}
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
                <div style={{ width: 85, height: 105, background: 'rgba(255,255,255,0.1)', borderRadius: 8, border: '2px solid var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem', flexShrink: 0, overflow: 'hidden' }}>
                  {dashboardData?.user?.photo ? (
                    <img src={dashboardData.user.photo} alt="Student" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    '👤'
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {studentName}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '0.15rem' }}>
                    ID: <strong style={{ color: 'var(--gold)' }}>{studentIdNumber}</strong>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '0.15rem', lineHeight: 1.3 }}>
                    Program: <strong>{programName}</strong>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                    Valid Thru: <strong>08/2028</strong> • Status: <strong>Active</strong>
                  </div>
                </div>
              </div>

              {/* Card Footer Barcode Representation */}
              <div style={{ marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ letterSpacing: '0.25em', fontFamily: 'monospace', fontSize: '0.85rem', color: '#e2e8f0' }}>
                  ||||| | |||| ||| ||||| || |||
                </div>
                <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Campus & Library Card</span>
              </div>
            </div>
          ) : (
            <div style={{ minHeight: 200, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--gold)', marginBottom: '0.5rem' }}>TERMS & EMERGENCY SERVICES</div>
                <p style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.4, margin: 0 }}>
                  This card is the property of BMI University and must be surrendered upon request. Non-transferable. Valid for official campus entry, library borrowing, and academic verification.
                </p>
                <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: '#cbd5e1' }}>
                  <div>🚨 Campus Security: +1 (800) 555-BMI-HELP</div>
                  <div>🏛️ Registrar Office: registrar@bmi.edu</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.65rem', color: '#64748b' }}>
                BMI UNIVERSITY • ACCREDITED HIGHER EDUCATION INSTITUTION
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>
        
        {/* Upload Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="card">
            <h2 style={{ fontSize: '1.2rem', color: 'var(--navy)', marginBottom: '0.5rem' }}>🪪 Student ID Card Photograph</h2>
            <p style={{ color: 'var(--slate)', fontSize: '0.9rem', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              Upload a clear, passport-style photograph for your official digital and physical Student ID card.
            </p>

            <div className="upload-zone" style={{ padding: '2rem 1.5rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📷</div>
              <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: '0.25rem' }}>Drag & Drop your ID photo here</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--slate)', marginBottom: '1rem' }}>JPEG, PNG, or WebP up to 10MB</div>

              <label className="btn btn-gold btn-sm" style={{ cursor: loading ? 'not-allowed' : 'pointer', display: 'inline-flex' }}>
                {loading ? 'Uploading...' : 'Browse Local Files'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  disabled={loading}
                  onChange={(e) => handleUpload(e, 'id_document')}
                />
              </label>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1.2rem', color: 'var(--navy)', marginBottom: '0.5rem' }}>📄 Official Prior Transcripts & Diplomas</h2>
            <p style={{ color: 'var(--slate)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Upload official high school or university transcripts for transfer credit evaluation.
            </p>

            <div className="upload-zone" style={{ padding: '2rem 1.5rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📜</div>
              <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: '0.25rem' }}>Upload PDF Transcript File</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--slate)', marginBottom: '1rem' }}>Official PDF documents max 10MB</div>

              <label className="btn btn-outline btn-sm" style={{ cursor: loading ? 'not-allowed' : 'pointer', display: 'inline-flex' }}>
                {loading ? 'Uploading...' : 'Select PDF File'}
                <input
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  disabled={loading}
                  onChange={(e) => handleUpload(e, 'transcript_document')}
                />
              </label>
            </div>
          </div>

        </div>

        {/* Downloads & Credential Verification Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="card" style={{ borderTop: '4px solid var(--gold)' }}>
            <h2 style={{ fontSize: '1.15rem', color: 'var(--navy)', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              Download Credentials
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ padding: '0.85rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--navy)' }}>Admission Letter</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--slate)' }}>Official PDF • Verified</div>
                </div>
                <button className="btn btn-navy btn-sm" onClick={() => setActiveModal('admission')}>
                  View / Print
                </button>
              </div>

              <div style={{ padding: '0.85rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--navy)' }}>Verification Letter</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--slate)' }}>Enrollment Proof</div>
                </div>
                <button className="btn btn-navy btn-sm" onClick={() => setActiveModal('verification')}>
                  View / Print
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1.05rem', color: 'var(--navy)', marginBottom: '0.5rem' }}>Document Processing Time</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Uploaded documents are reviewed by the Registrar within 1–2 business days. Status updates will appear on your dashboard.
            </p>
          </div>

        </div>

      </div>

      {/* ─── Document Letter Modals ─── */}
      {activeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ maxWidth: 650, width: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'white', padding: '2rem', borderRadius: 'var(--radius-lg)' }}>
            
            {/* Header with seal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--navy)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', color: 'var(--navy)', margin: 0, fontWeight: 900 }}>
                  BMI UNIVERSITY
                </h2>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>Office of Admissions & Student Records</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--slate)' }}>
                Date: {new Date().toLocaleDateString()}
              </div>
            </div>

            {activeModal === 'admission' ? (
              <div>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--navy)', marginBottom: '1rem' }}>OFFICIAL LETTER OF ADMISSION</h3>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--navy)' }}>
                  Dear <strong>{studentName}</strong>,
                </p>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#334155' }}>
                  We are pleased to officially inform you that you have been admitted to <strong>BMI University</strong> in the <strong>{programName}</strong> program. Your academic credentials and application have met all institutional standards.
                </p>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#334155' }}>
                  Student ID Number: <strong>{studentIdNumber}</strong><br />
                  Academic Term: <strong>Fall 2026</strong>
                </p>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#334155' }}>
                  Welcome to our global community of academic scholarship and ministry leadership.
                </p>
              </div>
            ) : (
              <div>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--navy)', marginBottom: '1rem' }}>CERTIFICATE OF ENROLLMENT VERIFICATION</h3>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#334155' }}>
                  To Whom It May Concern:
                </p>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#334155' }}>
                  This official document certifies that <strong>{studentName}</strong> (Student ID: <strong>{studentIdNumber}</strong>) is currently an active enrolled student in good standing at BMI University, matriculating in the <strong>{programName}</strong>.
                </p>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#334155' }}>
                  Enrollment Status: <strong>Full-Time Active Student</strong><br />
                  Anticipated Degree Completion: <strong>August 2028</strong>
                </p>
              </div>
            )}

            <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>Official Seal • Verified Electronic Record</div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setActiveModal(null)}>Close</button>
                <button className="btn btn-gold btn-sm" onClick={() => window.print()}>🖨️ Print Letter</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
