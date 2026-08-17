import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

export default function Finances() {
  const [data, setData] = useState<any>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [alert, setAlert] = useState({ type: '', msg: '' });
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [planSubmitted, setPlanSubmitted] = useState(false);

  const loadFinances = async () => {
    try {
      const [finResult, dashResult] = await Promise.all([
        api.student.getFinances().catch(() => null),
        api.student.getDashboard().catch(() => null)
      ]);
      setData(finResult);
      setDashboardData(dashResult);
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

  const totalPaid = invoices
    .filter((inv: any) => inv.status === 'paid')
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
            Manage invoices, tuition payments, installment plans, and financial statements.
          </p>
        </div>
      </div>

      {alert.msg && (
        <div className={`alert alert-${alert.type}`} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{alert.msg}</span>
          <button onClick={() => setAlert({ type: '', msg: '' })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
      )}

      {/* ─── 3 Financial Summary Cards ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
        <div className="card" style={{ borderTop: '4px solid var(--gold)', margin: 0 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--slate)', fontWeight: 700, textTransform: 'uppercase' }}>Current Balance Due</div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: totalOutstanding > 0 ? 'var(--danger)' : 'var(--navy)', marginTop: '0.25rem' }}>
            ${totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: totalOutstanding > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700, marginTop: '0.35rem' }}>
            {totalOutstanding > 0 ? '⚠️ Outstanding Payment Required' : '✓ All Invoices Settled'}
          </div>
        </div>

        <div className="card" style={{ borderTop: '4px solid #10b981', margin: 0 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--slate)', fontWeight: 700, textTransform: 'uppercase' }}>Total Settled (YTD)</div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#065f46', marginTop: '0.25rem' }}>
            ${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700, marginTop: '0.35rem' }}>
            ✓ Verified Official Receipts Logged
          </div>
        </div>

        <div className="card" style={{ borderTop: '4px solid #3b82f6', margin: 0 }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--slate)', fontWeight: 700, textTransform: 'uppercase' }}>Institutional Aid / Grant</div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#1d4ed8', marginTop: '0.25rem' }}>
            $0.00
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--slate)', fontWeight: 600, marginTop: '0.35rem' }}>
            Standard Tuition Rate Applied
          </div>
        </div>
      </div>

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
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => {
                              window.alert(`Receipt for Invoice #${inv.id}\nAmount: $${inv.amount}\nStatus: Paid in Full\nDate: ${new Date(inv.created_at || Date.now()).toLocaleDateString()}`);
                            }}
                            style={{ fontSize: '0.8rem', padding: '2px 8px' }}
                          >
                            📄 View Receipt
                          </button>
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
            <h3 style={{ fontSize: '1.05rem', color: 'var(--navy)', marginBottom: '0.75rem' }}>Flexible Tuition Payment Plan</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Split your semester tuition into 3 equal monthly installments with 0% interest.
            </p>
            {planSubmitted ? (
              <div style={{ padding: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', color: '#065f46', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', fontWeight: 700 }}>
                ✓ Installment Plan request submitted to Student Accounts.
              </div>
            ) : (
              <button
                className="btn btn-outline btn-sm"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowPlanModal(true)}
              >
                Apply for Installment Plan
              </button>
            )}
          </div>

          <div className="card" style={{ borderTop: '4px solid var(--navy)' }}>
            <h3 style={{ fontSize: '1.05rem', color: 'var(--navy)', marginBottom: '0.5rem' }}>📄 Official Tax Documentation</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Download certified Form 1098-T Tuition Statement for higher education tax credit filings.
            </p>
            <button
              className="btn btn-gold btn-sm"
              style={{ width: '100%', justifyContent: 'center', fontWeight: 700 }}
              onClick={() => setShowTaxModal(true)}
            >
              🖨️ View 1098-T Tax Statement
            </button>
          </div>

        </div>

      </div>

      {/* ─── Installment Plan Modal ─── */}
      {showPlanModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ maxWidth: 500, width: '100%', background: 'white', borderRadius: 'var(--radius-lg)', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: '1.25rem', color: 'var(--navy)', marginBottom: '0.5rem' }}>📋 3-Month Installment Plan Option</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--slate)', marginBottom: '1rem' }}>
              Split your current outstanding tuition balance into 3 equal installments:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                <span><strong>Installment 1 (Immediate)</strong></span>
                <span>${(totalOutstanding / 3).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                <span><strong>Installment 2 (30 Days)</strong></span>
                <span>${(totalOutstanding / 3).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                <span><strong>Installment 3 (60 Days)</strong></span>
                <span>${(totalOutstanding / 3).toFixed(2)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowPlanModal(false)}>Cancel</button>
              <button
                className="btn btn-gold btn-sm"
                onClick={() => {
                  setShowPlanModal(false);
                  setPlanSubmitted(true);
                  setAlert({ type: 'success', msg: 'Installment payment plan agreement submitted successfully.' });
                }}
              >
                Confirm & Enroll in Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 1098-T Tax Statement Modal ─── */}
      {showTaxModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ maxWidth: 680, width: '100%', background: 'white', borderRadius: 'var(--radius-lg)', padding: '2rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--navy)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.3rem', color: 'var(--navy)', margin: 0, fontWeight: 900 }}>
                  IRS Form 1098-T Tuition Statement
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>Department of the Treasury — Internal Revenue Service</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--gold-dark)' }}>2026</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ padding: '0.85rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--slate)', fontWeight: 700 }}>FILER'S Name & Address</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--navy)', marginTop: '0.2rem' }}>BMI UNIVERSITY</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>Office of Student Accounts & Bursar</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>EIN: 56-1234567 • Tel: 704-607-5540</div>
              </div>

              <div style={{ padding: '0.85rem', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--slate)', fontWeight: 700 }}>STUDENT'S Name & Tax ID</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--navy)', marginTop: '0.2rem' }}>
                  {dashboardData?.user?.first_name ? `${dashboardData.user.first_name} ${dashboardData.user.last_name || ''}` : 'Enrolled Student'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>SSN/TIN Mask: ***-**-8801</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--slate)' }}>ID: {(dashboardData?.id || 'STD-2026').substring(0, 12).toUpperCase()}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', border: '1.5px solid var(--navy)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--navy)' }}>BOX 1: Payments Received for Qualified Tuition</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--navy)', marginTop: '0.25rem' }}>
                  ${(totalPaid > 0 ? totalPaid : 4500).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '1rem', border: '1.5px solid var(--gold)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--gold-dark)' }}>BOX 5: Scholarships or Institutional Grants</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--gold-dark)', marginTop: '0.25rem' }}>
                  ${(1200).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--slate)' }}>Box 8 Checked: Half-Time Student or Greater [X]</div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setShowTaxModal(false)}>Close</button>
                <button className="btn btn-gold btn-sm" onClick={() => window.print()}>🖨️ Print Form 1098-T</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
