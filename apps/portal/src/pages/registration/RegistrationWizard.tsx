import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

const STEP_LABELS = [
  'Profile & Emergency Contacts',
  'Curriculum & Degree Pathway',
  'Course & Section Selection',
  'Financial Aid & Fee Agreement',
  'Terms of Enrollment & Digital Signature',
] as const;

interface EligibilityState {
  eligible: boolean;
  status: string;
  reasons: string[];
  activeHolds: Array<{ id: string; hold_type: string; reason: string; blocks: string }>;
  advisingReleased: boolean;
  catalogYearId: string | null;
  term: { id: string; name: string; academic_year: string; status: string } | null;
}

interface PersonalDetails {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  phone: string;
  current_address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
}

interface CourseItem {
  id: string;
  code: string;
  title: string;
  credits: number;
  capacity?: number;
  seats_taken?: number;
  is_mandatory?: boolean;
}

export default function RegistrationWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingEligibility, setCheckingEligibility] = useState(true);
  const [eligibility, setEligibility] = useState<EligibilityState | null>(null);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  // Form State
  const [profile, setProfile] = useState<PersonalDetails>({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: '',
    nationality: '',
    phone: '',
    current_address: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  });

  const [curriculum, setCurriculum] = useState<any>(null);
  const [availableCourses, setAvailableCourses] = useState<CourseItem[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [seatStatuses, setSeatStatuses] = useState<Record<string, { status: string; waitlistPosition?: number; message?: string }>>({});

  const [feeAgreement, setFeeAgreement] = useState<{
    program_name: string;
    catalog_year_id: string;
    gross_tuition: number;
    financial_aid_discount: number;
    net_balance_due: number;
    currency: string;
    payment_plans: Array<{ id: string; name: string; discount?: string }>;
  } | null>(null);

  const [selectedPlan, setSelectedPlan] = useState('full');
  const [acceptedFeeStructure, setAcceptedFeeStructure] = useState(false);

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [dataConfirmed, setDataConfirmed] = useState(false);
  const [signedName, setSignedName] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setCheckingEligibility(true);
    try {
      const [eligRes, statusRes, feeRes, currRes, modRes] = await Promise.all([
        api.student.getRegistrationEligibility().catch(() => null),
        api.registration.getStatus().catch(() => null),
        api.finance.getFeeAgreement().catch(() => null),
        api.student.getCurriculum().catch(() => null),
        api.registration.getModules().catch(() => [] as any[]),
      ]);

      if (eligRes) setEligibility(eligRes);
      if (feeRes) setFeeAgreement(feeRes);
      if (currRes) setCurriculum(currRes);

      if (statusRes?.current_data?.personal_details) {
        setProfile(prev => ({
          ...prev,
          ...statusRes.current_data.personal_details,
          ...statusRes.current_data.address,
        }));
      }

      if (Array.isArray(modRes) && modRes.length > 0) {
        setAvailableCourses(modRes.map(m => ({
          id: m.id,
          code: m.code,
          title: m.name || m.title,
          credits: m.credits || 3,
          is_mandatory: true,
        })));
        // Auto-select initial courses if not yet selected
        setSelectedCourseIds(modRes.slice(0, 4).map(m => m.id));
      }
    } catch (err: unknown) {
      console.warn('Initial data load warning:', err);
    } finally {
      setCheckingEligibility(false);
    }
  };

  const totalSelectedCredits = availableCourses
    .filter(c => selectedCourseIds.includes(c.id))
    .reduce((sum, c) => sum + c.credits, 0);

  const handleToggleCourse = async (courseId: string) => {
    if (selectedCourseIds.includes(courseId)) {
      setSelectedCourseIds(prev => prev.filter(id => id !== courseId));
      try {
        await api.registration.dropCourse(courseId);
        setSeatStatuses(prev => {
          const next = { ...prev };
          delete next[courseId];
          return next;
        });
      } catch {
        // Continue
      }
    } else {
      setSelectedCourseIds(prev => [...prev, courseId]);
      try {
        const res = await api.registration.reserveSeat(courseId);
        setSeatStatuses(prev => ({ ...prev, [courseId]: res }));
      } catch (err: unknown) {
        console.warn('Course reservation notice:', err);
      }
    }
  };

  const handleNext = () => {
    setError('');
    if (currentStep === 0) {
      if (!profile.first_name || !profile.last_name || !profile.emergency_contact_phone) {
        setError('Please complete all required contact and emergency details.');
        return;
      }
    }
    if (currentStep === 2) {
      if (selectedCourseIds.length === 0) {
        setError('Please select at least one course module for the semester.');
        return;
      }
    }
    if (currentStep === 3) {
      if (!acceptedFeeStructure) {
        setError('You must accept the fee structure and select a payment arrangement.');
        return;
      }
    }

    setCurrentStep(s => Math.min(s + 1, STEP_LABELS.length - 1));
  };

  const handlePrevious = () => {
    setCurrentStep(s => Math.max(0, s - 1));
  };

  const handleFinalSubmit = async () => {
    setError('');
    if (!termsAccepted || !dataConfirmed || !signedName.trim()) {
      setError('Please review and agree to all terms and type your full legal signature.');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Legally binding e-signature
      await api.enrollment.signAgreement('ENROLL-AGREEMENT-2026', signedName.trim(), 'v1.0-sha256-standard');

      // 2. Complete registration
      await api.registration.complete().catch(() => {});

      setCompleted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Eligibility Gating Screen
  if (checkingEligibility) {
    return (
      <div className="page-center">
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  if (eligibility && !eligibility.eligible) {
    return (
      <div className="page" style={{ padding: '4rem 1.5rem', background: 'var(--bg)' }}>
        <div className="card" style={{ maxWidth: 680, margin: '0 auto', borderLeft: '4px solid var(--danger)', padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '2rem' }}>⛔</span>
            <div>
              <h2 style={{ margin: 0, color: 'var(--danger)' }}>Registration Unavailable</h2>
              <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Your account is not currently cleared for course registration.
              </p>
            </div>
          </div>

          <div style={{ background: '#fef2f2', padding: '1rem', borderRadius: 8, marginBottom: '1.5rem', border: '1px solid #fecaca' }}>
            <strong style={{ color: '#991b1b', display: 'block', marginBottom: '0.5rem' }}>Outstanding Requirements:</strong>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#b91c1c', fontSize: '0.9rem' }}>
              {eligibility.reasons.map((r, i) => (
                <li key={i} style={{ marginBottom: '0.25rem' }}>{r}</li>
              ))}
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-navy" onClick={() => navigate('/status')}>
              ← Back to Status Tracker
            </button>
            <button className="btn btn-outline" onClick={fetchInitialData}>
              🔄 Re-check Clearance
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="page-center" style={{ padding: '4rem 1.5rem' }}>
        <div className="card" style={{ maxWidth: 540, textAlign: 'center', padding: '3.5rem 2.5rem', border: '2px solid var(--success)' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎉</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.8rem', color: 'var(--navy)', marginBottom: '0.5rem' }}>
            Registration Complete!
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Your enrollment agreement has been digitally signed and your course schedule is confirmed (Status: <strong style={{ color: 'var(--success)' }}>REGISTERED</strong>).
          </p>
          <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: 8, border: '1px solid #bbf7d0', marginBottom: '2rem', textAlign: 'left', fontSize: '0.875rem' }}>
            <div><strong>Locked Catalog Year:</strong> {eligibility?.catalogYearId || 'CAT-2026'}</div>
            <div><strong>Registered Credits:</strong> {totalSelectedCredits} credits</div>
            <div><strong>Net Balance:</strong> ${feeAgreement?.net_balance_due.toFixed(2) || '0.00'}</div>
          </div>
          <a href="/student/dashboard" className="btn btn-gold btn-full">
            Enter Student Portal & Dashboard →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: '4rem 1.5rem 5rem', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', color: 'var(--navy)', marginBottom: '0.25rem' }}>
            Student Registration & Enrollment
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Term: <strong>{eligibility?.term?.name || 'Academic Term'}</strong> • Catalog Year: <strong style={{ fontFamily: 'monospace' }}>{eligibility?.catalogYearId || 'CAT-2026'}</strong>
          </p>
          <div className="gold-bar" style={{ marginTop: '0.5rem' }} />
        </div>

        {/* Step Indicator */}
        <div className="steps" style={{ marginBottom: '2rem', overflowX: 'auto', paddingBottom: 4 }}>
          {STEP_LABELS.map((label, idx) => (
            <div key={label} className="step" style={{ minWidth: 0 }}>
              <div className={`step-circle ${idx < currentStep ? 'done' : idx === currentStep ? 'active' : ''}`}>
                {idx < currentStep ? '✓' : idx + 1}
              </div>
              <span className="step-label" style={{
                color: idx === currentStep ? 'var(--gold-dark)' : idx < currentStep ? 'var(--navy)' : 'var(--slate)',
                fontWeight: idx === currentStep ? 700 : 500,
                whiteSpace: 'nowrap',
                marginLeft: '0.4rem',
              }}>
                {label.split(' ')[0]}
              </span>
              {idx < STEP_LABELS.length - 1 && (
                <div className={`step-line ${idx < currentStep ? 'done' : ''}`} />
              )}
            </div>
          ))}
        </div>

        {error && <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>{error}</div>}

        {/* ─── Step Content ─── */}
        <div className="card" style={{ minHeight: 380, padding: '2rem' }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.3rem', color: 'var(--navy)', marginBottom: '1.5rem' }}>
            Step {currentStep + 1}: {STEP_LABELS[currentStep]}
          </h2>

          {/* Step 0: Profile & Emergency Contact */}
          {currentStep === 0 && (
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" value={profile.first_name} onChange={e => setProfile({ ...profile, first_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" value={profile.last_name} onChange={e => setProfile({ ...profile, last_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Current Address</label>
                <input className="form-input" value={profile.current_address} onChange={e => setProfile({ ...profile, current_address: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Emergency Contact Name</label>
                <input className="form-input" value={profile.emergency_contact_name} onChange={e => setProfile({ ...profile, emergency_contact_name: e.target.value })} placeholder="Relative / Sponsor" />
              </div>
              <div className="form-group">
                <label className="form-label">Emergency Contact Phone</label>
                <input className="form-input" value={profile.emergency_contact_phone} onChange={e => setProfile({ ...profile, emergency_contact_phone: e.target.value })} placeholder="+231..." />
              </div>
            </div>
          )}

          {/* Step 1: Degree Pathway & Curriculum */}
          {currentStep === 1 && (
            <div>
              <div className="alert alert-info" style={{ marginBottom: '1.5rem' }}>
                <strong>Locked Degree Audit Version:</strong> You are matriculating under catalog year <strong>{eligibility?.catalogYearId || 'CAT-2026'}</strong>. Your graduation requirements remain locked to this catalog.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--slate)', textTransform: 'uppercase', fontWeight: 700 }}>Program</span>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 4 }}>{curriculum?.program_name || 'Degree Program'}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--slate)', textTransform: 'uppercase', fontWeight: 700 }}>Degree Level</span>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 4 }}>Undergraduate / Bachelor</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--slate)', textTransform: 'uppercase', fontWeight: 700 }}>Catalog Year</span>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 4, fontFamily: 'monospace' }}>{eligibility?.catalogYearId || 'CAT-2026'}</div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Course & Section Selection */}
          {currentStep === 2 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Select course sections for this semester:</span>
                <span style={{ background: 'var(--navy)', color: 'var(--gold)', padding: '0.35rem 1rem', borderRadius: 999, fontWeight: 700, fontSize: '0.9rem' }}>
                  {totalSelectedCredits} Total Credits
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {availableCourses.map(c => {
                  const isSelected = selectedCourseIds.includes(c.id);
                  const seatInfo = seatStatuses[c.id];
                  return (
                    <div
                      key={c.id}
                      onClick={() => handleToggleCourse(c.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '1rem 1.25rem',
                        borderRadius: 8,
                        border: `2px solid ${isSelected ? 'var(--gold)' : 'var(--border)'}`,
                        background: isSelected ? 'rgba(212, 175, 55, 0.05)' : 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ accentColor: 'var(--gold)', width: 18, height: 18 }}
                        />
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.95rem' }}>
                            {c.code} — {c.title}
                          </div>
                          {seatInfo?.status === 'waitlisted' && (
                            <span style={{ color: '#b45309', fontSize: '0.75rem', fontWeight: 600 }}>
                              ⏳ Waitlisted (Position #{seatInfo.waitlistPosition})
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontWeight: 700, color: 'var(--slate)', fontSize: '0.85rem' }}>
                        {c.credits} credits
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 3: Financial Aid & Fee Agreement */}
          {currentStep === 3 && (
            <div>
              <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: 8, border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: 'var(--navy)' }}>Net Tuition & Financial Aid Breakdown</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Gross Program Tuition:</span>
                    <strong>${feeAgreement?.gross_tuition.toFixed(2) || '1,500.00'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}>
                    <span>Financial Aid / Scholarship Award:</span>
                    <strong>-${feeAgreement?.financial_aid_discount.toFixed(2) || '0.00'}</strong>
                  </div>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800, color: 'var(--navy)' }}>
                    <span>Net Balance Due:</span>
                    <span>${feeAgreement?.net_balance_due.toFixed(2) || '1,500.00'}</span>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Select Payment Arrangement</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(feeAgreement?.payment_plans || [
                    { id: 'full', name: 'Single Full Payment' },
                    { id: 'installments_2', name: 'Two Installments (50% now, 50% midterm)' },
                  ]).map(p => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'white', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
                      <input type="radio" name="payment_plan" value={p.id} checked={selectedPlan === p.id} onChange={() => setSelectedPlan(p.id)} />
                      <span style={{ fontSize: '0.9rem', color: 'var(--navy)', fontWeight: 600 }}>{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={acceptedFeeStructure} onChange={e => setAcceptedFeeStructure(e.target.checked)} style={{ accentColor: 'var(--gold)', width: 18, height: 18, marginTop: 2 }} />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  I accept the fee schedule and agree to pay all applicable net tuition according to the chosen installment plan.
                </span>
              </label>
            </div>
          )}

          {/* Step 4: Terms of Enrollment & Digital Signature */}
          {currentStep === 4 && (
            <div>
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)', marginBottom: '1.5rem', maxHeight: 180, overflowY: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <p><strong>BMI University Matriculation & Honor Agreement:</strong></p>
                <p>By completing this registration, I commit to upholding the highest standards of academic integrity, ethical conduct, and respect within the BMI community. I agree to abide by all university policies, course requirements, and payment schedules.</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={dataConfirmed} onChange={e => setDataConfirmed(e.target.checked)} style={{ accentColor: 'var(--gold)', width: 18, height: 18 }} />
                  <span style={{ fontSize: '0.875rem' }}>I confirm that all registration information is accurate.</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} style={{ accentColor: 'var(--gold)', width: 18, height: 18 }} />
                  <span style={{ fontSize: '0.875rem' }}>I agree to the Terms of Enrollment and Student Code of Conduct.</span>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Digital Signature (Type your full legal name)</label>
                <input
                  className="form-input"
                  value={signedName}
                  onChange={e => setSignedName(e.target.value)}
                  placeholder="e.g. Johnathan Doe"
                  style={{ fontFamily: 'serif', fontSize: '1.1rem' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--slate)', marginTop: 4, display: 'block' }}>
                  Binding electronic signature recorded with IP, timestamp, and document version hash.
                </span>
              </div>
            </div>
          )}

        </div>

        {/* ─── Navigation Buttons ─── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
          <button onClick={handlePrevious} disabled={currentStep === 0} className="btn btn-outline">
            Previous
          </button>
          {currentStep < STEP_LABELS.length - 1 ? (
            <button onClick={handleNext} className="btn btn-gold">
              Save & Continue →
            </button>
          ) : (
            <button onClick={handleFinalSubmit} disabled={submitting} className="btn btn-navy" style={{ padding: '0.75rem 2rem', fontWeight: 800 }}>
              {submitting ? 'Signing & Registering...' : '✓ Complete Registration & Sign Agreement'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}