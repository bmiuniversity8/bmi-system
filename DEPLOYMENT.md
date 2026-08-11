# BMI University ERP — Deployment & Canonical Domain Standards

## 1. Canonical Production URLs (Use These Always)

To avoid confusion caused by Cloudflare's dynamic preview deployment hashes (e.g. `612805e2.bmi-ums-88m.pages.dev`), **always** use the following stable canonical domain aliases:

| Component | Canonical Production URL | Custom Domain (Primary) |
|---|---|---|
| **UMS Frontend** | `https://bmi-ums-88m.pages.dev` | `https://ums.bmiuniversities.org` |
| **Admissions Portal** | `https://bmi-portal.pages.dev` | `https://portal.bmiuniversities.org` |
| **University Web** | `https://bmi-university.pages.dev` | `https://bmiuniversities.org` |
| **Backend API Worker** | `https://bmi-api.bmi-university.workers.dev` | — |

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
