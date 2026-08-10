import { useState } from 'react';
import { api } from '../../lib/api';

export default function Documents() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      
      {/* ─── Page Title Header ─── */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2rem', color: 'var(--navy)', marginBottom: '0.25rem', fontWeight: 900 }}>
          📁 Student Document Hub & Verification
        </h1>
        <p style={{ color: 'var(--slate)', fontSize: '0.95rem' }}>
          Upload identity credentials, request official transcripts, and download admission letters.
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
                <button className="btn btn-navy btn-sm">Download</button>
              </div>

              <div style={{ padding: '0.85rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--navy)' }}>Verification Letter</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--slate)' }}>Enrollment Proof</div>
                </div>
                <button className="btn btn-navy btn-sm">Download</button>
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

    </div>
  );
}
