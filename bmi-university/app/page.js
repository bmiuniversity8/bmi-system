"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { PROGRAMS as FALLBACK_PROGRAMS, API_WORKER_URL } from "@bmi/shared";

const slides = [
  { bg: "/images/home-hero/home-hero-1-graduation.jpg", tagline: "Empowering Christ-Centered Scholars & Global Leaders" },
  { bg: "/images/home-hero/home-hero-2-students.jpg",   tagline: "Rigorous Theological Scholarship & Practical Ministry" },
  { bg: "/images/home-hero/home-hero-3-campus.jpg",     tagline: "Transforming Nations Through Biblical Truth" },
  { bg: "/images/home-hero/home-hero-4-library.jpg",    tagline: "Accredited Higher Education for Kingdom Impact" },
];

export default function HomePage() {
  const [current, setCurrent] = useState(0);
  const [activeTab, setActiveTab] = useState("bachelors");
  const [verifyCode, setVerifyCode] = useState("");
  const intervalRef = useRef(null);

  // ── Load authoritative program data from API worker (with fallback) ──
  const [programs, setPrograms] = useState(FALLBACK_PROGRAMS);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_WORKER_URL}/api/public/programs`, { cache: 'force-cache' });
        if (!res.ok) return;
        const body = await res.json();
        if (!body?.success || !Array.isArray(body.data)) return;
        if (cancelled) return;
        setPrograms(body.data.map(p => ({
          label: p.label ?? p.name,
          level: p.level,
          description: p.description,
          icon: p.icon ?? undefined,
        })));
      } catch { /* keep fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const bachelors = useMemo(() => programs.filter(p => p.level === 'undergraduate').map(p => ({ title: p.label, desc: p.description, credits: "120 Credits", duration: "4 Years" })), [programs]);
  const masters   = useMemo(() => programs.filter(p => p.level === 'graduate').map(p => ({ title: p.label, desc: p.description, credits: "48 Credits", duration: "2 Years" })), [programs]);
  const doctorates= useMemo(() => programs.filter(p => p.level === 'doctorate').map(p => ({ title: p.label, desc: p.description, credits: "60 Credits", duration: "3 Years" })), [programs]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCurrent((p) => (p + 1) % slides.length);
    }, 6500);
    return () => clearInterval(intervalRef.current);
  }, []);

  const goTo = (i) => {
    clearInterval(intervalRef.current);
    setCurrent(i);
    intervalRef.current = setInterval(() => setCurrent((p) => (p + 1) % slides.length), 6500);
  };

  const handleVerifySubmit = (e) => {
    e.preventDefault();
    if (!verifyCode.trim()) return;
    window.open(`https://verify.bmiuniversities.org/verify?code=${encodeURIComponent(verifyCode.trim())}`, '_blank');
  };

  const programMap = { bachelors, masters, doctorates };

  return (
    <main id="main-content">

      {/* ─── HERO SECTION ─── */}
      <section aria-label="Hero" style={{ position: "relative", width: "100%", height: "100vh", minHeight: "680px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "60px" }}>
        {slides.map((s, i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url('${s.bg}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: i === current ? 1 : 0,
              transition: "opacity 1.5s cubic-bezier(0.4, 0, 0.2, 1)",
              transform: i === current ? "scale(1)" : "scale(1.04)",
              transitionProperty: "opacity, transform",
            }}
          />
        ))}
        {/* Deep Oxford Navy Gradient Vignette */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(9, 18, 35, 0.65) 0%, rgba(9, 18, 35, 0.85) 65%, #091223 100%)" }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: "1020px", padding: "0 2rem", textAlign: "center" }}>
          <div className="animate-hero">
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "rgba(197, 160, 72, 0.15)",
              border: "1.5px solid rgba(197, 160, 72, 0.6)",
              color: "#e5c578",
              fontSize: "0.82rem",
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "0.5rem 1.4rem",
              borderRadius: "999px",
              marginBottom: "1.75rem",
              backdropFilter: "blur(12px)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            }}>
              <span>✦</span> {slides[current].tagline}
            </span>
          </div>

          <h1 className="animate-hero-delay" style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 900,
            fontSize: "clamp(2.7rem, 6vw, 5.2rem)",
            color: "#ffffff",
            lineHeight: 1.1,
            marginBottom: "1.5rem",
            letterSpacing: "-0.03em",
            textShadow: "0 4px 30px rgba(0,0,0,0.6)",
          }}>
            Scholarship for Eternity.<br />
            <span style={{
              background: "linear-gradient(135deg, #c5a048 0%, #e5c578 50%, #c5a048 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              filter: "drop-shadow(0 2px 10px rgba(197, 160, 72, 0.4))",
            }}>
              Leadership for Today.
            </span>
          </h1>

          <p className="animate-hero-delay-2" style={{
            color: "rgba(255, 255, 255, 0.9)",
            fontSize: "clamp(1.05rem, 2vw, 1.3rem)",
            lineHeight: 1.8,
            maxWidth: "740px",
            margin: "0 auto 2.5rem",
            fontWeight: 400,
          }}>
            Developing Christ-centered men and women at <strong>Bethel Ministries International University</strong> with the values, theological depth, and leadership skills essential to transform nations.
          </p>

          <div className="animate-hero-delay-2" style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/apply" className="btn btn-gold" style={{ fontSize: "1rem", padding: "1rem 2.4rem" }}>
              Apply for Admission →
            </Link>
            <Link href="/academics" className="btn btn-outline-white" style={{ fontSize: "1rem", padding: "1rem 2.2rem" }}>
              Explore Degree Programs
            </Link>
          </div>
        </div>

        {/* Slide navigation indicators */}
        <div style={{ position: "absolute", bottom: "2.5rem", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "0.75rem", zIndex: 2 }}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Slide ${i + 1}`}
              style={{
                width: i === current ? "36px" : "12px",
                height: "8px",
                borderRadius: "999px",
                background: i === current ? "linear-gradient(90deg, #c5a048, #e5c578)" : "rgba(255,255,255,0.35)",
                border: "none",
                cursor: "pointer",
                transition: "all 0.35s ease",
                padding: 0,
                boxShadow: i === current ? "0 0 10px rgba(197, 160, 72, 0.7)" : "none",
              }}
            />
          ))}
        </div>
      </section>

      {/* ─── LIVE INSTITUTIONAL METRICS TICKER ─── */}
      <section style={{ background: "#060d19", borderTop: "3px solid var(--color-gold, #c5a048)", borderBottom: "1px solid rgba(197,160,72,0.2)", padding: "3rem 2rem" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "2rem" }}>
          
          <div style={{ textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.08)", padding: "0 1rem" }} className="metric-box">
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: "2.8rem", fontWeight: 900, color: "var(--color-gold, #c5a048)", lineHeight: 1 }}>100%</div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "white", marginTop: "0.5rem" }}>Christ-Centered Doctrine</div>
            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", marginTop: "0.2rem" }}>Rooted in biblical inerrancy & scholarship</div>
          </div>

          <div style={{ textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.08)", padding: "0 1rem" }} className="metric-box">
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: "2.8rem", fontWeight: 900, color: "#ffffff", lineHeight: 1 }}>40+</div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--color-gold-light, #e5c578)", marginTop: "0.5rem" }}>Nations Represented</div>
            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", marginTop: "0.2rem" }}>Worldwide student body & alumni network</div>
          </div>

          <div style={{ textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.08)", padding: "0 1rem" }} className="metric-box">
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: "2.8rem", fontWeight: 900, color: "var(--color-gold, #c5a048)", lineHeight: 1 }}>1 : 12</div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "white", marginTop: "0.5rem" }}>Faculty Mentorship Ratio</div>
            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", marginTop: "0.2rem" }}>Personal pastoral & academic guidance</div>
          </div>

          <div style={{ textAlign: "center", padding: "0 1rem" }}>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: "2.8rem", fontWeight: 900, color: "#ffffff", lineHeight: 1 }}>QAHE</div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--color-gold-light, #e5c578)", marginTop: "0.5rem" }}>Accredited Institution</div>
            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", marginTop: "0.2rem" }}>International quality assurance certified</div>
          </div>

        </div>
      </section>

      {/* ─── INTERACTIVE DEGREE & CAREER PATHWAY EXPLORER ─── */}
      <section aria-labelledby="programs-heading" style={{ background: "#f8fafc", padding: "7rem 2rem" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
          
          <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
            <div className="gold-bar" style={{ margin: "0 auto 1.25rem" }} />
            <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--color-gold-dark, #a07e2c)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              ACADEMIC DEGREE PATHWAYS
            </span>
            <h2 id="programs-heading" style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(2.2rem, 3.8vw, 3.2rem)", color: "#091223", marginTop: "0.35rem", marginBottom: "1rem", letterSpacing: "-0.03em" }}>
              Accredited Programs of Study
            </h2>
            <p style={{ color: "#64748b", fontSize: "1.1rem", maxWidth: "700px", margin: "0 auto", lineHeight: 1.7 }}>
              Earn your accredited degree online or in our hybrid format. Discover flexible, comprehensive theological curriculum at the bachelor&apos;s, master&apos;s, and doctoral levels.
            </p>
          </div>

          {/* Level Filter Tabs */}
          <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem", marginBottom: "3.5rem", flexWrap: "wrap" }}>
            {[
              ["bachelors", "Undergraduate (Bachelors)"],
              ["masters", "Graduate (Masters)"],
              ["doctorates", "Doctoral Studies (Ph.D. / Th.D.)"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  padding: "0.85rem 2rem",
                  borderRadius: "999px",
                  border: "2px solid",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  background: activeTab === key ? "#091223" : "#ffffff",
                  color: activeTab === key ? "#e5c578" : "#0e1d38",
                  borderColor: activeTab === key ? "#091223" : "#cbd5e1",
                  boxShadow: activeTab === key ? "0 8px 24px rgba(9, 18, 35, 0.2)" : "none",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Program Cards Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "2rem" }}>
            {programMap[activeTab].map((p, i) => (
              <article
                key={i}
                className="program-card"
                style={{
                  background: "#ffffff",
                  borderRadius: "20px",
                  padding: "2.25rem",
                  border: "1px solid rgba(14, 29, 56, 0.08)",
                  boxShadow: "0 4px 16px rgba(9, 18, 35, 0.04)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <div style={{ width: "42px", height: "4px", borderRadius: "999px", background: "linear-gradient(90deg, #c5a048, #e5c578)" }} />
                    <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--color-gold-dark, #a07e2c)", background: "#f7f3e8", padding: "3px 10px", borderRadius: 99 }}>
                      {p.credits}
                    </span>
                  </div>

                  <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: "1.25rem", color: "#091223", lineHeight: 1.3, marginBottom: "0.75rem" }}>
                    {p.title}
                  </h3>
                  <p style={{ color: "#64748b", fontSize: "0.92rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
                    {p.desc}
                  </p>
                </div>

                <div style={{ paddingTop: "1.25rem", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 600 }}>Duration: {p.duration}</span>
                  <Link
                    href="/apply"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      color: "var(--color-gold-dark, #a07e2c)",
                      fontWeight: 800,
                      fontSize: "0.9rem",
                      transition: "transform 0.2s ease",
                    }}
                  >
                    Apply Now →
                  </Link>
                </div>
              </article>
            ))}
          </div>

          {/* Graduate Certificate Banner */}
          <div style={{
            marginTop: "4rem",
            background: "linear-gradient(135deg, #091223 0%, #0e1d38 50%, #172a4d 100%)",
            borderRadius: "24px",
            padding: "3rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "2rem",
            border: "1px solid rgba(197, 160, 72, 0.3)",
            boxShadow: "0 20px 50px rgba(9, 18, 35, 0.35)",
          }}>
            <div>
              <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "var(--color-gold-light, #e5c578)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                EXECUTIVE & POSTGRADUATE PATHWAYS
              </span>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: "1.7rem", color: "#ffffff", margin: "0.35rem 0 0.75rem 0" }}>
                Executive Graduate Certificates
              </h3>
              <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.95rem", margin: 0 }}>
                Targeted professional ministry credentials in <strong>Christian Studies</strong>, <strong>Spiritual Formation</strong>, and <strong>Theological Leadership</strong>.
              </p>
            </div>
            <Link href="/apply" className="btn btn-gold" style={{ fontSize: "0.95rem", padding: "0.9rem 2rem" }}>
              Apply for Certificate →
            </Link>
          </div>

        </div>
      </section>

      {/* ─── CHANCELLOR'S INSTITUTIONAL WELCOME ─── */}
      <section style={{ background: "#ffffff", padding: "7rem 2rem", borderTop: "1px solid #e2e8f0" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "5rem", alignItems: "center" }} className="split-section">
          
          <div>
            <div className="gold-bar" />
            <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--color-gold-dark, #a07e2c)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              PRESIDENT & CHANCELLOR&apos;S ADDRESS
            </span>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(2rem, 3.5vw, 2.8rem)", color: "#091223", marginTop: "0.4rem", marginBottom: "1.5rem", lineHeight: 1.2, letterSpacing: "-0.025em" }}>
              A Sacred Mandate for Global Leadership
            </h2>
            
            <p style={{ fontSize: "1.1rem", lineHeight: 1.8, color: "#334155", marginBottom: "1.25rem", fontStyle: "italic" }}>
              &ldquo;At Bethel Ministries International University, higher education is not merely an academic endeavor; it is a sacred calling to equip visionary leaders who will stand as pillars of integrity, divine truth, and scholarly excellence in a rapidly changing world.&rdquo;
            </p>
            
            <p style={{ fontSize: "0.95rem", lineHeight: 1.8, color: "#64748b", marginBottom: "2rem" }}>
              Our faculty members are respected scholars and active ministry practitioners dedicated to guiding every student with deep personal investment, rigorous academic discipline, and unwavering biblical fidelity.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#091223", display: "flex", alignItems: "center", justifyContent: "center", color: "#c5a048", fontSize: "1.5rem" }}>
                🏛️
              </div>
              <div>
                <div style={{ fontWeight: 800, color: "#091223", fontSize: "1.05rem" }}>Office of the Academic Senate</div>
                <div style={{ fontSize: "0.82rem", color: "#64748b" }}>Bethel Ministries International University</div>
              </div>
            </div>
          </div>

          {/* Quick Credential Verification Interactive Box */}
          <div style={{
            background: "linear-gradient(135deg, #091223 0%, #0e1d38 100%)",
            borderRadius: "24px",
            padding: "2.75rem",
            color: "white",
            border: "2px solid rgba(197, 160, 72, 0.4)",
            boxShadow: "0 25px 60px rgba(9, 18, 35, 0.3)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1.4rem" }}>🛡️</span>
              <span style={{ fontSize: "0.8rem", fontWeight: 800, color: "#e5c578", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                INSTITUTIONAL TRUST & VERIFICATION
              </span>
            </div>

            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: "1.6rem", fontWeight: 800, margin: "0.5rem 0 1rem 0" }}>
              Verify Diplomas & Records
            </h3>

            <p style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.75)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
              Employers, embassies, and academic institutions can instantly validate the authenticity of any BMI University diploma, transcript, or letter using our cryptographic registry.
            </p>

            <form onSubmit={handleVerifySubmit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <input
                type="text"
                placeholder="e.g. BMI-VER-88219"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                style={{
                  padding: "0.85rem 1.25rem",
                  borderRadius: "10px",
                  border: "1px solid rgba(197,160,72,0.5)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#ffffff",
                  fontSize: "0.95rem",
                  outline: "none",
                }}
              />
              <button type="submit" className="btn btn-gold" style={{ width: "100%", padding: "0.85rem" }}>
                Verify Document Authenticity →
              </button>
            </form>
            <div style={{ marginTop: "1rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
              Cryptographically secured via verify.bmiuniversities.org
            </div>
          </div>

        </div>
      </section>

      {/* ─── ACCREDITATION & ADMISSIONS CTA ─── */}
      <section style={{ background: "linear-gradient(135deg, #091223 0%, #0e1d38 50%, #172a4d 100%)", padding: "7rem 2rem", position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5rem", alignItems: "center" }} className="split-section">
          <div>
            <div className="gold-bar" />
            <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "var(--color-gold-light, #e5c578)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              ACCREDITED HIGHER EDUCATION
            </span>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 900, fontSize: "clamp(2.2rem, 3.8vw, 3.4rem)", color: "#ffffff", margin: "0.4rem 0 1.5rem 0", lineHeight: 1.15, letterSpacing: "-0.025em" }}>
              Ready to Begin Your <span style={{ color: "#e5c578" }}>Academic Journey?</span>
            </h2>
            <p style={{ color: "rgba(255,255,255,0.85)", fontSize: "1.1rem", lineHeight: 1.8, marginBottom: "1.25rem" }}>
              BMI University is fully accredited by the <strong>International Association for Quality Assurance in Higher Education (QAHE)</strong>. Our rigorous degree programs are engineered to prepare you for global Christian scholarship and leadership.
            </p>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.88rem", marginBottom: "2.5rem", fontStyle: "italic", lineHeight: 1.6 }}>
              Degree programs have been declared exempt from licensure requirements under North Carolina General Statutes (G.S.) 116-15(d) for religious education.
            </p>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <Link href="/apply" className="btn btn-gold" style={{ fontSize: "1rem", padding: "1rem 2.25rem" }}>
                Apply for Fall 2026 →
              </Link>
              <Link href="/admissions" className="btn btn-outline-white" style={{ fontSize: "1rem", padding: "1rem 2rem" }}>
                View Admissions Criteria
              </Link>
            </div>
          </div>

          <div style={{ borderRadius: "24px", overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", aspectRatio: "4/3", border: "2px solid rgba(197,160,72,0.4)" }}>
            <img
              src="/images/admissions-hero/admissions-hero-1-students-group.jpg"
              alt="BMI University graduating students"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 900px) {
          .split-section { grid-template-columns: 1fr !important; gap: 3rem !important; }
          .metric-box { border-right: none !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; padding-bottom: 1.5rem !important; }
        }
      `}</style>
    </main>
  );
}
