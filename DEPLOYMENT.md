# BMI University ERP — Deployment & Canonical Domain Standards

## 1. Production Domain & Subdomain Topology

All production traffic is routed via the primary secured domain **`bmiuniversities.org`** and its dedicated subdomains:

| Service / Component | Custom Domain (Primary) | Fallback / Alias | Purpose |
|---|---|---|---|
| **University Website** | `https://bmiuniversities.org` | `https://www.bmiuniversities.org` | Public marketing, academic catalog, institutional info |
| **Admissions / Student Portal** | `https://portal.bmiuniversities.org` | `https://bmi-portal.pages.dev` | Application submissions, status tracking, student portal |
| **University Management System (UMS)** | `https://ums.bmiuniversities.org` | `https://bmi-ums.pages.dev` | Faculty, registrar, financial & institutional ERP |
| **API Gateway / Cloudflare Worker** | `https://api.bmiuniversities.org` | `https://bmi-api.bmi-university.workers.dev` | Unified backend REST API & webhooks |
| **Document Verification** | `https://verify.bmiuniversities.org` | `https://bmiuniversities.org/verify` | Public validation of transcripts, degrees & letters |
| **Direct Application Gateway** | `https://apply.bmiuniversities.org` | `https://portal.bmiuniversities.org/register` | Express direct applicant intake |

---

## 2. Standard Deployment Commands

All deployments have been standardized in the root `package.json` to automatically bind to the `--branch=main` production deployment target:

```bash
# Deploy API Cloudflare Worker
pnpm run deploy:api

# Deploy UMS Frontend to Cloudflare Pages (Production Main)
pnpm run deploy:ums

# Deploy Student Portal to Cloudflare Pages (Production Main)
pnpm run deploy:portal

# Deploy All Services
pnpm run deploy:all
```

---

## 3. Why Dynamic Hash URLs Exist & Best Practices

1. **Cloudflare Preview Hashes**: Whenever a build is uploaded, Cloudflare Pages outputs an immutable preview URL (e.g., `https://<hash>.<project>.pages.dev`).
2. **Main Branch Alias**: Deploying with `--branch=main` automatically updates the root alias (`https://bmi-ums.pages.dev`) to point to the newest build immediately.
3. **Best Practice**: Bookmark the root alias (`https://bmi-ums.pages.dev`) or custom domain and ignore individual build hash URLs outputted in terminal logs.
