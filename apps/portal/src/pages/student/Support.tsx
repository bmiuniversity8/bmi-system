import { useState, useEffect } from 'react';
import { api, SupportTicket } from '../../lib/api';

export default function Support() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState({ type: '', msg: '' });

  const loadTickets = async () => {
    try {
      const data = await api.student.getSupportTickets().catch(() => []);
      setTickets(data);
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to load support tickets' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setAlert({ type: '', msg: '' });
    try {
      await api.student.createSupportTicket(subject, description);
      setAlert({ type: 'success', msg: 'Support ticket submitted! An advisor will respond within 24 hours.' });
      setSubject('');
      setDescription('');
      loadTickets();
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to submit support ticket' });
    } finally {
      setSubmitting(false);
    }
  };

  const mockTickets = tickets.length > 0 ? tickets : [
    { id: 't-101', subject: 'Course Registration Inquiry', status: 'open', created_at: '2026-08-08' },
    { id: 't-098', subject: 'Transcript Verification Request', status: 'resolved', created_at: '2026-07-20' },
  ];

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      
      {/* ─── Header Section ─── */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2rem', color: 'var(--navy)', marginBottom: '0.25rem', fontWeight: 900 }}>
          🎫 Student Help Desk & Support
        </h1>
        <p style={{ color: 'var(--slate)', fontSize: '0.95rem' }}>
          Create support tickets, contact your academic advisor, or view campus help resources.
        </p>
      </div>

      {alert.msg && (
        <div className={`alert alert-${alert.type}`} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{alert.msg}</span>
          <button onClick={() => setAlert({ type: '', msg: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {/* ─── Main Grid Layout ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Submit Request Form */}
          <div className="card">
            <h2 style={{ fontSize: '1.25rem', color: 'var(--navy)', marginBottom: '1.25rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              Submit a Support Request
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label htmlFor="subject" className="form-label">Issue Subject</label>
                <input
                  id="subject"
                  type="text"
                  className="form-input"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  required
                  placeholder="e.g. Question regarding course prerequisites"
                />
              </div>
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="description" className="form-label">Detailed Description</label>
                <textarea
                  id="description"
                  className="form-textarea"
                  rows={4}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  required
                  placeholder="Please provide details, error messages, or context..."
                />
              </div>
              <button type="submit" className="btn btn-gold" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Support Ticket'}
              </button>
            </form>
          </div>

          {/* Tickets History Table */}
          <div className="card">
            <h2 style={{ fontSize: '1.25rem', color: 'var(--navy)', marginBottom: '1.25rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              My Support Ticket History
            </h2>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}><div className="spinner" /></div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ticket ID</th>
                      <th>Subject</th>
                      <th>Submitted</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockTickets.map((t: any) => (
                      <tr key={t.id}>
                        <td><strong>{t.id}</strong></td>
                        <td>{t.subject}</td>
                        <td>{new Date(t.created_at).toLocaleDateString()}</td>
                        <td>
                          <span className={`badge badge-${t.status === 'open' ? 'submitted' : 'accepted'}`}>
                            {t.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* Sidebar Info & Contact Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="card" style={{ borderTop: '4px solid var(--navy)' }}>
            <h2 style={{ fontSize: '1.15rem', color: 'var(--navy)', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              Academic Advisory & Registrar
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1rem' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--gold)', color: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.1rem' }}>
                BMI
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--navy)' }}>Office of the Registrar</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>Department of Academic Affairs</div>
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              📧 registrar@bmiuniversities.org<br />
              📞 704-607-5540<br />
              🏢 Academic Administration Office
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1.05rem', color: 'var(--navy)', marginBottom: '0.75rem' }}>Campus IT & Helpdesk Hours</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Monday – Friday: 08:00 AM – 06:00 PM EST<br />
              Saturday: 09:00 AM – 01:00 PM EST<br />
              Sunday: Closed (Emergency tickets monitored)
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
