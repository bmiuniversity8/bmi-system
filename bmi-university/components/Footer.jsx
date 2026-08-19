"use client";

import { useState } from "react";
import Link from "next/link";

const quickLinks = [
  { label: "Academic Programs", href: "/academics" },
  { label: "Admissions & Aid", href: "/admissions" },
  { label: "QAHE Accreditation", href: "/accreditation" },
  { label: "About BMI University", href: "/about" },
  { label: "Contact & Campus", href: "/contact" },
  { label: "Online Application", href: "/apply" },
];

const programCategories = [
  { label: "Bachelor's Degrees", href: "/academics#undergraduate" },
  { label: "Master's Degrees", href: "/academics#graduate" },
  { label: "Doctoral Studies (Ph.D./Th.D.)", href: "/academics#doctorate" },
  { label: "Graduate Certificates", href: "/academics#certificate" },
];

const institutionalPortals = [
  { label: "Student Portal Login", href: "https://portal.bmiuniversities.org", external: true },
  { label: "Document Verification Engine", href: "https://verify.bmiuniversities.org", external: true },
  { label: "University Management System (UMS)", href: "https://ums.bmiuniversities.org", external: true },
  { label: "Privacy Policy & FERPA", href: "/privacy", external: false },
];

export default function Footer() {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e) => {
    e.preventDefault();
    if (email) setSubscribed(true);
  };

  return (
    <footer style={{ background: "linear-gradient(180deg, #091223 0%, #050a14 100%)", color: "#ffffff", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* ── Gold Accent Top Border ── */}
      <div style={{ height: "4px", background: "linear-gradient(90deg, #c5a048 0%, #e5c578 50%, #c5a048 100%)" }} />

      {/* ── Main Footer Grid ── */}
      <div style={{
        maxWidth: "1280px",
        margin: "0 auto",
        padding: "64px 32px 48px",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "48px",
      }}
        className="footer-grid"
      >

        {/* Column 1 — Brand & Accreditation */}
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <Link href="/" aria-label="BMI University — Home" style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
            <img src="/images/bmi-crest-270.png" alt="BMI University Crest" style={{ height: "54px", width: "auto", objectFit: "contain", filter: "drop-shadow(0 2px 8px rgba(197, 160, 72, 0.3))" }} />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontWeight: 900, fontSize: "1.5rem", color: "#ffffff", letterSpacing: "0.04em", lineHeight: 0.95 }}>BMI</span>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: "0.58rem", color: "#e5c578", letterSpacing: "0.25em", textTransform: "uppercase", marginTop: "3px" }}>University</span>
            </div>
          </Link>

          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.88rem", lineHeight: 1.7, margin: 0 }}>
            Bishop Mathew Institute is dedicated to empowering Christ-centered scholars with biblical truth, academic excellence, and servant leadership.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.5rem" }}>
            <Link href="/accreditation" aria-label="QAHE Accreditation" style={{ display: "inline-block" }}>
              <span style={{
                background: "#ffffff",
                padding: "6px 10px",
                borderRadius: "6px",
                display: "inline-flex",
                alignItems: "center",
                boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
              }}>
                <img 
                  src="/images/qahe-logo.jpg" 
                  alt="QAHE Accredited Institution" 
                  style={{ height: "38px", width: "auto", objectFit: "contain", display: "block" }} 
                />
              </span>
            </Link>
          </div>
        </div>

        {/* Column 2 — Academic Programs */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: "1.05rem", fontWeight: 800, color: "#e5c578", letterSpacing: "0.05em", margin: 0 }}>
            Academic Degrees
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {programCategories.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.88rem", transition: "color 0.2s" }}
                  onMouseEnter={(e) => e.currentTarget.style.color = "#e5c578"}
                  onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.75)"}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Column 3 — Portals & Verification */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: "1.05rem", fontWeight: 800, color: "#e5c578", letterSpacing: "0.05em", margin: 0 }}>
            Portals & Verification
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {institutionalPortals.map((item) => (
              <li key={item.label}>
                {item.external ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.88rem", transition: "color 0.2s" }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "#e5c578"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.75)"}
                  >
                    {item.label} ↗
                  </a>
                ) : (
                  <Link
                    href={item.href}
                    style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.88rem", transition: "color 0.2s" }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "#e5c578"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.75)"}
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Column 4 — Institutional Contact */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: "1.05rem", fontWeight: 800, color: "#e5c578", letterSpacing: "0.05em", margin: 0 }}>
            Admissions Office
          </h3>
          <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.88rem", lineHeight: 1.6, margin: 0 }}>
            Office of Admissions & Student Records<br />
            Bishop Mathew Institute<br />
            <strong>Email:</strong> admin@bmiuniversities.org<br />
            <strong>Admissions:</strong> admissions@bmiuniversities.org
          </p>

          <form onSubmit={handleSubscribe} style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                padding: "0.65rem 0.9rem",
                borderRadius: "8px",
                border: "1px solid rgba(197,160,72,0.4)",
                background: "rgba(255,255,255,0.08)",
                color: "#ffffff",
                fontSize: "0.85rem",
                outline: "none",
              }}
            />
            <button type="submit" className="btn btn-gold" style={{ padding: "0.6rem 1rem", fontSize: "0.82rem" }}>
              {subscribed ? "✓ Subscribed" : "Subscribe to Academic Updates"}
            </button>
          </form>
        </div>

      </div>

      {/* ── Bottom Bar ── */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.08)",
        padding: "24px 32px",
        background: "#04070d",
        fontSize: "0.78rem",
        color: "rgba(255,255,255,0.5)",
        textAlign: "center",
      }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            © {new Date().getFullYear()} Bishop Mathew Institute (BMI University). All rights reserved.
          </div>
          <div>
            Exempt from licensure under N.C.G.S. 116-15(d) for religious education • QAHE Accredited
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .footer-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 32px !important; }
        }
        @media (max-width: 580px) {
          .footer-grid { grid-template-columns: 1fr !important; gap: 28px !important; }
        }
      `}</style>
    </footer>
  );
}
