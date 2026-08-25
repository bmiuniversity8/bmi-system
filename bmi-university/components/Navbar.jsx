"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { name: "Academics",  href: "/academics"  },
  { name: "Admissions", href: "/admissions" },
  { name: "Accreditation", href: "/accreditation" },
  { name: "About",      href: "/about"      },
  { name: "Contact",    href: "/contact"    },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [pathname]);

  return (
    <>
      <header
        role="banner"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          transition: "all 0.35s ease",
        }}
      >
        {/* ── Top Institutional Utility Bar ── */}
        <div
          style={{
            background: "linear-gradient(90deg, #1a0040 0%, #2d1060 100%)",
            borderBottom: "1px solid rgba(197, 160, 72, 0.2)",
            padding: "0.4rem 2rem",
            fontSize: "0.75rem",
            color: "rgba(255, 255, 255, 0.75)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
          className="top-utility-bar"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--color-gold-light, #e5c578)", fontWeight: 700 }}>
              <span>✦</span> QAHE Accredited Higher Education
            </span>
            <span className="hide-mobile" style={{ color: "rgba(255,255,255,0.3)" }}>|</span>
            <span className="hide-mobile">admissions@bmiuniversities.org</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
            <Link
              href="/verify"
              style={{ color: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", gap: "0.3rem", transition: "color 0.2s" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#c5a048"}
              onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.85)"}
            >
              <span>🛡️</span> Verify Credentials
            </Link>
            <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>
            <a
              href="https://portal.bmiuniversities.org"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-gold, #c5a048)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.3rem" }}
            >
              <span>👤</span> Student Portal →
            </a>
          </div>
        </div>

        {/* ── Main Sticky Navigation Bar ── */}
        <div
          style={{
            height: "82px",
            background: scrolled
              ? "rgba(45, 16, 96, 0.98)"
              : "rgba(45, 16, 96, 0.93)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: "1px solid rgba(197, 160, 72, 0.25)",
            boxShadow: scrolled ? "0 10px 30px rgba(26, 0, 64, 0.6)" : "none",
            transition: "all 0.35s ease",
          }}
          className="main-nav-bar"
        >
          <nav
            aria-label="Main navigation"
            style={{
              maxWidth: "1280px",
              margin: "0 auto",
              padding: "0 2rem",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Link
              href="/"
              aria-label="BMI University — Home"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                textDecoration: "none",
              }}
            >
              <img
                src="/images/bmi-logo-2.png"
                alt="BMI University Crest"
                style={{
                  height: "58px",
                  width: "auto",
                  objectFit: "contain",
                  filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.35))",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
                <span style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: 900,
                  fontSize: "1.45rem",
                  color: "#ffffff",
                  letterSpacing: "-0.01em",
                  lineHeight: 1,
                }}>
                  BMI UNIVERSITY
                </span>
                <span style={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: "0.58rem",
                  color: "var(--color-gold, #c5a048)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  marginTop: "4px",
                }}>
                  Bethel Ministries International
                </span>
              </div>
            </Link>

            {/* ── Desktop Links ── */}
            <div style={{ display: "flex", alignItems: "center", gap: "2.2rem" }} className="desktop-nav">
              <ul style={{ display: "flex", alignItems: "center", gap: "0.5rem", listStyle: "none", margin: 0, padding: 0 }}>
                {navLinks.map((link) => {
                  const isActive = pathname === link.href;
                  return (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        aria-current={isActive ? "page" : undefined}
                        style={{
                          display: "inline-block",
                          padding: "0.5rem 0.9rem",
                          borderRadius: "8px",
                          fontWeight: isActive ? 800 : 600,
                          fontSize: "0.92rem",
                          color: isActive ? "#e5c578" : "#ffffff",
                          position: "relative",
                          transition: "all 0.2s ease",
                          letterSpacing: "0.01em",
                        }}
                      >
                        {link.name}
                        {isActive && (
                          <span
                            aria-hidden="true"
                            style={{
                              position: "absolute",
                              bottom: "-2px",
                              left: "0.9rem",
                              right: "0.9rem",
                              height: "2.5px",
                              borderRadius: "999px",
                              background: "linear-gradient(90deg, #c5a048, #e5c578)",
                              boxShadow: "0 0 8px rgba(229, 197, 120, 0.6)",
                            }}
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <div style={{ display: "flex", gap: "0.85rem", alignItems: "center" }}>
                <Link
                  href="/apply"
                  className="btn btn-gold"
                  style={{ whiteSpace: "nowrap", fontSize: "0.88rem", padding: "0.65rem 1.4rem" }}
                >
                  Apply Today →
                </Link>
                <a
                  href="https://www.paypal.com/donate/?hosted_button_id=NTSHAE86BEUBN"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-white"
                  style={{ whiteSpace: "nowrap", fontSize: "0.88rem", padding: "0.65rem 1.25rem" }}
                >
                  Give
                </a>
              </div>
            </div>

            {/* ── Mobile Hamburger ── */}
            <button
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              onClick={() => setMobileOpen(!mobileOpen)}
              style={{
                display: "none",
                flexDirection: "column",
                gap: "5px",
                padding: "8px",
                background: "none",
                border: "none",
                cursor: "pointer",
                borderRadius: "8px",
              }}
              className="mobile-hamburger"
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    display: "block",
                    width: "26px",
                    height: "2.5px",
                    borderRadius: "999px",
                    background: "#c5a048",
                    transition: "all 0.3s ease",
                    transform:
                      mobileOpen
                        ? i === 0 ? "rotate(45deg) translate(5px, 5px)"
                        : i === 1 ? "scaleX(0)"
                        : "rotate(-45deg) translate(5px, -5px)"
                        : "none",
                    opacity: mobileOpen && i === 1 ? 0 : 1,
                  }}
                />
              ))}
            </button>
          </nav>
        </div>
      </header>

      {/* ── Mobile Backdrop Overlay ── */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 998,
            transition: "opacity 0.3s ease",
          }}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile Drawer ── */}
      <div
        id="mobile-nav"
        role="dialog"
        aria-label="Navigation menu"
        aria-modal={mobileOpen}
        style={{
          position: "fixed",
          top: "var(--mobile-drawer-top, 112px)",
          left: 0,
          right: 0,
          bottom: 0,
          background: "linear-gradient(180deg, rgba(26, 0, 64, 0.98) 0%, rgba(45, 16, 96, 0.98) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "0.75rem",
          transform: mobileOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          padding: "1.5rem 1.25rem calc(2rem + env(safe-area-inset-bottom, 0px))",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        }}
        className="mobile-drawer"
      >
        <ul style={{ width: "100%", maxWidth: "380px", listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <li key={link.name}>
                <Link
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setMobileOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    minHeight: "48px",
                    padding: "0.85rem 1.25rem",
                    borderRadius: "12px",
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    color: isActive ? "#e5c578" : "rgba(255,255,255,0.92)",
                    background: isActive ? "rgba(197,160,72,0.15)" : "rgba(255,255,255,0.03)",
                    borderLeft: isActive ? "4px solid #c5a048" : "4px solid transparent",
                    transition: "all 0.2s ease",
                  }}
                >
                  <span>{link.name}</span>
                  <span style={{ fontSize: "0.9rem", opacity: 0.6 }}>→</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div style={{ width: "100%", maxWidth: "380px", marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Link
            href="/apply"
            onClick={() => setMobileOpen(false)}
            className="btn btn-gold"
            style={{ width: "100%", fontSize: "1rem", minHeight: "48px" }}
          >
            Apply Today →
          </Link>
          <a
            href="https://portal.bmiuniversities.org"
            className="btn btn-outline-white"
            style={{ width: "100%", fontSize: "0.95rem", minHeight: "48px", textAlign: "center" }}
          >
            👤 Student Portal Login
          </a>
        </div>
      </div>

      {/* ── Responsive Styling ── */}
      <style>{`
        @media (max-width: 992px) {
          .desktop-nav { display: none !important; }
          .mobile-hamburger { display: flex !important; }
          .mobile-drawer { display: flex !important; }
        }
        @media (min-width: 993px) {
          .mobile-drawer { display: none !important; }
        }
        @media (max-width: 640px) {
          .hide-mobile { display: none !important; }
          .top-utility-bar {
            padding: 0.3rem 0.75rem !important;
            font-size: 0.67rem !important;
            min-height: 28px;
          }
          .main-nav-bar {
            height: 64px !important;
          }
          :root {
            --navbar-height: 92px;
            --mobile-drawer-top: 92px;
          }
        }
        @media (max-width: 400px) {
          .top-utility-bar { font-size: 0.62rem !important; }
        }
      `}</style>
    </>
  );
}
