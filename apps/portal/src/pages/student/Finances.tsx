import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export default function Finances() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [alert, setAlert] = useState({ type: '', msg: '' });

  const loadFinances = async () => {
    try {
      const result = await api.student.getFinances().catch(() => null);
      setData(result);
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Failed to load finances' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFinances();
  }, []);

  const handlePay = async (invoiceId: string) => {
    setPaying(invoiceId);
    try {
      await api.student.payInvoice(invoiceId);
      setAlert({ type: 'success', msg: 'Payment processed successfully! Your receipt has been logged.' });
      loadFinances();
    } catch (e: any) {
      setAlert({ type: 'danger', msg: e.message || 'Payment failed' });
    } finally {
      setPaying(null);
    }
  };

  const invoices = data?.invoices || [];

  const totalOutstanding = invoices
    .filter((inv: any) => inv.status === 'unpaid' || inv.status === 'pending')
    .reduce((acc: number, curr: any) => acc + (Number(curr.amount) || 0), 0);

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      
      {/* ─── Header Section ─── */}
      <div style={{ marginBottom: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ fontSize: '2rem', color: 'var(--navy)', margin: 0, fontWeight: 900 }}>
              💳 Tuition & Student Financial Services
            </h1>
            <span className="badge badge-accepted" style={{ fontSize: '0.75rem' }}>Official Student Ledger</span>
          </div>
          <p style={{ color: 'var(--slate)', fontSize: '0.95rem', marginTop: '0.25rem' }}>
            Manage invoices, tuition payments, financial statements, and payment receipts.
          </p>
        </div>
      </div>

      {alert.msg && (
        <div className={`alert alert-${alert.type}`} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{alert.msg}</span>
          <button onClick={() => setAlert({ type: '', msg: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {/* ─── Grid: Invoices & Account Summary ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>
        
        {/* Invoices List */}
        <div className="card">
          <h2 style={{ fontSize: '1.25rem', color: 'var(--navy)', marginBottom: '1.25rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
            Student Statement & Invoices
          </h2>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <div className="spinner" style={{ width: 40, height: 40 }}></div>
            </div>
          ) : invoices.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--slate)' }}>
              <p style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>No active invoices or tuition statements found.</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Your student account is currently in good standing.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Issue Date</th>
                    <th>Due Date</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv: any) => (
                    <tr key={inv.id}>
                      <td>{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : 'N/A'}</td>
                      <td>{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : 'Immediate'}</td>
                      <td>
                        <span className={`badge badge-${inv.status === 'paid' ? 'accepted' : 'rejected'}`}>
                          {inv.status === 'paid' ? 'Paid In Full' : 'Unpaid'}
                        </span>
                      </td>
                      <td><strong>${Number(inv.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></td>
                      <td>
                        {inv.status === 'unpaid' || inv.status === 'pending' ? (
                          <button
                            className="btn btn-gold btn-sm"
                            onClick={() => handlePay(inv.id)}
                            disabled={paying === inv.id}
                          >
                            {paying === inv.id ? 'Processing...' : 'Pay Tuition Now'}
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.85rem', color: 'var(--success)', fontWeight: 700 }}>✓ Settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Account Summary & Payment Methods */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="card" style={{ borderTop: '4px solid var(--gold)' }}>
            <h2 style={{ fontSize: '1.15rem', color: 'var(--navy)', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              Account Balance Summary
            </h2>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--slate)', fontWeight: 600 }}>TOTAL AMOUNT DUE</div>
              <div style={{ fontSize: '2.25rem', fontWeight: 900, color: totalOutstanding > 0 ? 'var(--danger)' : 'var(--navy)' }}>
                ${totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ padding: '0.85rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              ℹ️ Payments are processed via encrypted financial gateway. Direct electronic check (ACH) and debit/credit cards accepted.
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1.05rem', color: 'var(--navy)', marginBottom: '0.75rem' }}>Need Financial Assistance?</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              BMI University offers tuition installment payment plans and institutional scholarship grants.
            </p>
            <button className="btn btn-outline btn-sm" style={{ width: '100%', justifyContent: 'center' }}>
              Apply for Payment Plan
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
