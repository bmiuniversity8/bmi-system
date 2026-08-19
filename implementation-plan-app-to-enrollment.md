# Implementation Plan: Application → Admissions → Registration → Enrollment System

**Owner:** Chief Developer
**Scope:** `apps/portal`, `apps/api`, `apps/admissions-admin` (new), `apps/registrar-admin` (extends existing admin surfaces)
**Goal:** A single authoritative state machine governing a person's journey from Prospect → Applicant → Admitted → Registered → Officially Enrolled, with no gaps in identity, financial, academic, or security boundaries at any transition.

---

## 0. Design Principle: One State Machine, Not Two Screens

The root issue in the original plan was that `Apply.tsx` and `RegistrationWizard.tsx` were designed as two independent UI flows. They must instead be two *views* into one backend-owned state machine. Every person in the system has exactly one `enrollment_status`, and every screen, permission, and API route is gated by it.

```
PROSPECT
   │  (starts application)
   ▼
APPLICANT_IN_PROGRESS
   │  (submits)
   ▼
APPLICANT_SUBMITTED ──────────────► APPLICANT_WITHDRAWN
   │  (admissions review)
   ▼
┌─────────────────────────────────────────┐
│  UNDER_REVIEW → CONDITIONAL / ADMITTED   │
│               → WAITLISTED               │
│               → DENIED                   │
└─────────────────────────────────────────┘
   │  (ADMITTED / CONDITIONAL only)
   ▼
OFFER_EXTENDED
   │  (student accepts + deposit, if required)
   ▼
OFFER_ACCEPTED
   │  (fires ProvisioningPipeline event — see Section 2)
   ▼
PROVISIONING_IN_PROGRESS  ← system-driven, no student action, typically seconds
   │  (UID + accounts + documents all confirmed issued)
   ▼
PROVISIONED / REGISTRATION_ELIGIBLE
   │  (holds clear, advising sign-off, registration window open)
   ▼
REGISTRATION_IN_PROGRESS
   │  (financial clearance + digital signature complete)
   ▼
REGISTERED
   │  (census date passes for the term — automated job)
   ▼
OFFICIALLY_ENROLLED  ← this is the moment the person is added to the Student Registry
```

This status field is the actual "single source of truth" — not just the absence of mock data. Every other fix below hangs off this.

---

## 1. Data Model Changes

### [NEW] `enrollment_status` table (or column + audit log)
- `person_id`, `status`, `term_id`, `changed_at`, `changed_by`, `reason`
- Every transition is logged, never overwritten — this is the audit trail admissions/registrar staff and compliance will need.

### [NEW] `admissions_decisions`
- `application_id`, `decision` (`admit` / `conditional` / `waitlist` / `deny`), `decided_by`, `decided_at`, `conditions` (text/array), `offer_expires_at`, `deposit_required`, `deposit_amount`

### [NEW] `enrollment_deposits`
- `application_id`, `amount`, `paid_at`, `payment_reference`, `status`

### [MODIFY] `students` table
- Add `catalog_year_id` (FK) — locked at admission, **not** recalculated live. This fixes the degree-audit versioning gap: a student's requirements are whatever catalog they were admitted under, unless they explicitly petition to change it.
- Add `official_student_id` — the permanent UID, populated only by the ID Generator during provisioning (Section 2), never before.

### [NEW] `holds`
- `student_id`, `type` (`financial` / `academic` / `disciplinary` / `immunization` / `advising`), `placed_by`, `placed_at`, `blocks` (array: `registration`, `transcripts`, `graduation`), `resolved_at`

### [NEW] `advising_releases`
- `student_id`, `term_id`, `advisor_id`, `released_at`, `pin` (optional, if using PIN-based release like Banner)

### [MODIFY] `documents`
- Add `verification_status` (`self_reported` / `pending_verification` / `verified` / `rejected`), `verified_by`, `verified_at`, `source` (`upload` / `clearinghouse` / `mail`)

### [NEW] `course_sections.seats_held` / atomic seat counter
- `capacity`, `seats_taken` (updated via DB-level atomic increment/decrement inside a transaction, not read-then-write from the app layer)
- `waitlist` table: `section_id`, `student_id`, `position`, `added_at`

### [NEW] `financial_aid_awards`
- Separate from `invoices`/fee agreement: `student_id`, `aid_type`, `amount`, `status` (`applied` / `awarded` / `disbursed`), `term_id`

### [MODIFY] `applications` (dedup)
- Before creating a new applicant record, run a match check against existing `persons` by (email, DOB, name-fuzzy-match, national ID if provided). Flag `possible_duplicate_of` for staff review rather than silently merging or silently creating a duplicate.

### [NEW] `esignatures`
- `document_id`, `person_id`, `signed_at`, `ip_address`, `user_agent`, `document_version_hash` — binding record for the enrollment agreement / honor pledge.

---

## 2. Auto-Provisioning Pipeline (Triggered on `OFFER_ACCEPTED`)

This is the piece the original plan compressed into a single "ProvisioningService" bullet. In practice, at every top UMS (Banner, Workday Student, Colleague, PeopleSoft Campus Solutions), this is the single most operationally sensitive stage in the whole system, because it's the moment an applicant becomes a real institutional identity with a permanent number, live accounts, and legal documents. It deserves its own pipeline design.

### 2.1 Exactly when it fires — and why not earlier or later

- **Not at `ADMITTED`/`OFFER_EXTENDED`.** An offer is not an enrollment. Provisioning here would generate permanent student numbers and institutional accounts for people who never enroll, polluting the registry, wasting license seats on IAM/LMS/email systems, and creating orphaned accounts that are a security liability.
- **Not at `REGISTERED`.** Too late — the student needs an account, login, and student number *in order to* register, receive their advisor assignment, and get billed. Every top UMS provisions identity before registration, not after.
- **Correct trigger: the moment `OFFER_ACCEPTED` is recorded** (and deposit payment confirmed, if the program requires one). This is an event, not a polled state — fire it from the same transaction that records offer acceptance, via an outbox/event table so it survives request failures.

### 2.2 Why this must be an asynchronous orchestrated pipeline, not inline API logic

Provisioning touches multiple systems that can each fail independently: the ID generator, the identity provider (IAM/SSO — e.g. Azure AD/Okta/Google Workspace), the LMS, the bursar/finance ledger, the library system, and the document generator. If this were done synchronously inside the "Accept Offer" API call, any one slow or failed downstream system would either hang the student's browser or leave the person half-provisioned with no record of what succeeded. Use a **saga/orchestrator pattern**: each step is idempotent, individually retryable, and its outcome is durably logged.

### [NEW] `provisioning_jobs` / `provisioning_steps`
- `person_id`, `job_id`, `step` (enum, see 2.3), `status` (`pending`/`succeeded`/`failed`/`retrying`), `attempted_at`, `completed_at`, `error`
- The student's status stays `PROVISIONING_IN_PROGRESS` until every *critical* step below succeeds; non-critical steps can complete asynchronously without blocking the student.

### 2.3 Pipeline steps, in order

1. **Re-run duplicate/identity resolution.** Time may have passed since application; re-check against `persons` before minting a permanent identity, so a returning applicant or existing alum doesn't get a second UID.
2. **Generate the permanent System UID** via a dedicated **ID Generator service** — not app-layer `MAX(id)+1` logic, which races under concurrent offer-acceptances. Use a DB sequence or a distributed ID generator with a checksum digit (same approach as a Banner ID or Workday Student ID). This number is immutable and never reused, even if the student later withdraws.
3. **Generate the term/program registration number**, if your institution distinguishes a lifetime UID from a per-matriculation registration/matric number (common in many university systems, including most Kenyan and other Commonwealth-model UMS). Kept separate from the UID so re-admits or program transfers don't collide.
4. **Create the core registrar record**, status `PROVISIONED`, linked to `catalog_year_id` locked at this moment.
5. **Provision the IAM/SSO account and institutional email** — call out to the identity provider, create the account, generate a first-login credential flow (never a plaintext password in an email — send a secure, time-limited set-password/MFA-enrollment link instead).
6. **Fan out downstream accounts**: portal login binding, LMS (Canvas/Moodle) enrollment shell, library account, bursar/finance account. Each is its own retryable step, not a monolithic call.
7. **Auto-assign an academic advisor** based on program/degree level, and place an initial `advising` hold (cleared at the student's first advising touchpoint, per most institutions' policy) — this is what the registration `EligibilityService` (Section 3) will check later.
8. **Generate and issue documents** (detail in 2.4).
9. **Send the welcome communication** — email + in-portal notification with the credential-setup link, official UID, and a "what's next" summary pointing at registration.
10. **Flip status to `PROVISIONED` → `REGISTRATION_ELIGIBLE`** once all critical steps confirm success (accounts exist, UID exists, admission-confirmation document issued). Non-critical steps (e.g. physical ID card print request) can still be finishing in the background.

### 2.4 Documents auto-issued at this stage

Issued the moment provisioning completes — **not** at registration, and not hand-triggered by staff:

- **Official Admission/Acceptance Confirmation Letter** (signed/sealed PDF, references the UID)
- **Digital Student ID** (provisional — carries UID, name, program, term; photo can be attached later if the institution collects one post-acceptance)
- **Welcome Packet / Next Steps guide** (orientation dates, registration window, advisor contact)
- **Account credential setup instructions**, sent via a separate secure channel/link from the documents above — credentials are never bundled into a general document email

**Deliberately NOT issued at this stage** (common mistake to avoid — these belong to later states):
- Registration confirmation / class schedule → only at `REGISTERED`
- Enrollment Agreement → generated for signature at registration, not before
- Tuition invoice / 1098-T → finance stage, depends on registered credit load
- Official Transcript → only after a term is completed
- Enrollment Verification Letter → only once `OFFICIALLY_ENROLLED`

### 2.5 Failure handling & idempotency

- Every step is idempotent: re-running "generate UID" for a person who already has one is a no-op that returns the existing UID, never a second one.
- If a critical step fails (UID generation, IAM account creation, admission-letter generation), the student sees a clear "we're finishing setting up your account" state — never a broken registration screen — and the job auto-retries with backoff. Ops gets alerted if a job is stuck beyond a threshold (e.g. 15 minutes).
- Non-critical step failures (e.g. library system momentarily down) do not block `REGISTRATION_ELIGIBLE` — they retry independently and are visible on a staff dashboard.

---

## 3. API Layer

### [MODIFY] `apps/portal/src/lib/api.ts` — extend beyond original scope

```
api.applications.create()
api.applications.submit()
api.applications.checkDuplicate(email, dob)

api.admissions.getDecision(applicationId)
api.admissions.acceptOffer(applicationId)          // fires the provisioning pipeline
api.admissions.payDeposit(applicationId, paymentRef)

api.provisioning.getStatus(personId)                 // NEW — polled by the "setting up your account" screen

api.student.getHolds()
api.student.getAdvisingRelease(termId)
api.student.getCurriculum()                            // reads catalog_year_id, not "live"
api.student.getRegistrationEligibility(termId)          // single check: holds + advising + window
api.registration.reserveSeat(sectionId)                  // atomic, transactional
api.registration.joinWaitlist(sectionId)
api.registration.dropCourse(sectionId)
api.finance.getFinancialAid(termId)
api.finance.getFeeAgreement(termId)
api.enrollment.signAgreement(documentId, signaturePayload)   // writes esignatures record
api.enrollment.getStatus()                                     // returns the canonical enrollment_status
```

### Backend services
- `AdmissionsDecisionService` — state transitions, offer expiry jobs (auto-expire unaccepted offers after N days), deposit reconciliation.
- `ProvisioningOrchestrator` — owns the Section 2 saga: UID generation, IAM/account fan-out, document issuance, retries, and status reporting.
- `EligibilityService` — the single source of truth for "can this person register right now," combining holds, advising release, registration window dates, and prerequisite checks. Both the UI and the seat-reservation endpoint call this — never duplicate the logic client-side.
- `SeatAllocationService` — wraps registration in a DB transaction with row-level locking on the section's seat counter, so two simultaneous registrations can't both claim the last seat. Falls through to waitlist automatically on capacity conflict.
- `CensusJob` — scheduled job that, per term, flips `REGISTERED` → `OFFICIALLY_ENROLLED` for students past the add/drop deadline with no blocking holds, and pushes them into the registrar's official enrollment count/registry feed.

---

## 4. Applicant-Facing Flow (`Apply.tsx`)

Keep the chronological reordering from the original plan — it's correct:

1. Personal Profile & Demographics
2. Academic Program & Degree Level
3. Educational History & Prior Qualifications
4. Personal Statement & Purpose
5. Supporting Documents & Credentials *(tagged `self_reported` until registrar verifies)*
6. Declarations, Review & Submission

**Add after step 6:**

7. **Application Status / Decision** — replaces the dead end after submit. Shows `UNDER_REVIEW`, or the decision once made, pulled from `admissions_decisions`.
8. **Offer Response** — appears only if `ADMITTED`/`CONDITIONAL`. Accept/decline, deposit payment if required, conditions displayed if conditional.
9. **"Setting Up Your Account"** — a short, honest loading/progress screen bound to `api.provisioning.getStatus()`, shown while the Section 2 pipeline runs (typically seconds, occasionally longer if a downstream system is slow). Never skip straight from "Accept Offer" to the registration wizard — show the student their UID and credentials are being created.
10. **Welcome / Provisioning Confirmation** — shown once provisioning completes; this is where the student first sees their official UID, digital ID, and admission letter, and is handed off into the registration flow.

---

## 5. Registration Flow (`RegistrationWizard.tsx`)

Entry to this wizard is gated by `enrollment_status === REGISTRATION_ELIGIBLE`. If not eligible, show *why* (open hold, advising not released, window not open, or provisioning still finishing) rather than a blank/broken wizard.

1. **Profile & Emergency Contact Verification**
2. **Degree Pathway & Curriculum Review** — pulled from the student's locked `catalog_year_id`, with a rare petition path to move to a newer catalog.
3. **Course & Module Selection**
   - Prerequisite checks enforced server-side before a section can be added to cart.
   - Seat reservation via `SeatAllocationService` — atomic, with automatic waitlist offer if full.
   - Live credit counter, checked against both financial aid eligibility thresholds and program max-credit rules.
4. **Financial Aid & Fee Agreement** *(split from a single "Fee Agreement" step)*
   - Show applied/awarded aid first, so the fee agreement reflects net balance, not gross tuition.
   - Payment plan/installment selection.
5. **Terms of Enrollment & Digital Signature**
   - Signature capture writes to `esignatures` with IP, user agent, timestamp, document version hash.
   - This step moves status to `REGISTERED`, not `OFFICIALLY_ENROLLED`.

**Add: Add/Drop & Waitlist management**, available post-registration up to the term's drop deadline, including waitlist auto-promotion notifications when a seat frees up.

---

## 6. Security & Access Boundaries

| Status | Portal access | Has UID / institutional accounts | Can hit registration API | Appears in registry |
|---|---|---|---|---|
| Prospect / Applicant (any pre-offer state) | Application flow + status page only | No | No (403 at API layer, not just hidden UI) | No |
| Offer Accepted → Provisioning in progress | Application status + progress screen only | Partial (accounts being created) | No | No |
| Provisioned / Registration Eligible | Full student portal, minus courses-in-progress views | Yes | Yes, subject to `EligibilityService` | No |
| Registered | Full portal | Yes | Yes (add/drop only) | Pending |
| Officially Enrolled | Full portal | Yes | Yes | Yes |

Enforce this server-side on every route, not just via UI conditionals — an applicant should never be one route away from the registration wizard, and a partially-provisioned account should never be treated as fully live.

---

## 7. Mock Data Removal (retained from original plan, now correctly scoped)

- Dashboard attendance → live from `/api/v1/attendance`, honest empty state.
- Academics degree audit → live curriculum, resolved against `catalog_year_id`, not "whatever is live today."
- Finances 1098-T → real invoice ledger, real financial aid awards, `$0.00` when zero.
- Support tickets → no `mockTickets` fallback.
- Graduation clearance → live credits + zero balance + `holds` table (the same table registration checks, so the logic is written once).

---

## 8. Verification Plan

### Automated tests
```bash
pnpm --filter @bmi/api test
pnpm --filter bmi-portal test
pnpm --filter @bmi/api test:concurrency     # seat-race test: N parallel registration
                                              # requests against a 1-seat section; exactly 1
                                              # succeeds, rest waitlist or reject
pnpm --filter @bmi/api test:provisioning     # NEW — idempotency test: fire OFFER_ACCEPTED
                                              # twice for the same person; confirm only one UID,
                                              # one set of accounts, no duplicate documents
```
- State machine transition tests: assert illegal transitions are rejected (e.g. `APPLICANT_SUBMITTED` → `REGISTERED` directly should be impossible).
- Access-control tests: applicant-status and provisioning-in-progress accounts hit registration endpoints → expect 403, not just hidden UI.
- Provisioning failure-injection tests: simulate IAM/LMS/document-generator downtime mid-pipeline, confirm retry succeeds without generating a duplicate UID.
- Duplicate-detection tests against known fuzzy-match cases.

### Manual / Browser Verification
- Full journey walkthrough: Prospect → Apply → Submit → (staff decision in admin) → Offer → Deposit → **Provisioning progress screen → Welcome screen with real UID and issued documents** → Register → Sign → (simulate census job) → confirm registry entry.
- Two-browser concurrency test: simultaneously register for the last seat in a section from two sessions, confirm only one succeeds and the other is waitlisted.
- Hold-blocking test: place a financial hold, confirm registration wizard blocks at step 3 with a clear reason.
- Catalog-year test: change a program's requirements mid-year, confirm already-admitted students' degree audits are unaffected until they petition.

---

## 9. Suggested Build Order

1. Data model + state machine + audit logging (foundation everything else depends on).
2. **`ProvisioningOrchestrator` + ID Generator + IAM integration** (security boundary — build and stress-test before any UI touches it; this is the highest-risk new component).
3. `EligibilityService`.
4. Admissions decision workflow + admin screen (even minimal) — unblocks end-to-end testing of the Applicant → Offer → Provisioning path.
5. Apply.tsx reorder + status/offer/provisioning-progress/welcome screens.
6. Registration wizard reorder + `SeatAllocationService` + holds/advising gating.
7. Financial aid split-out, add/drop/waitlist.
8. Mock data removal across dashboard/academics/finances/support/graduation (now trivial — these become read-throughs against the same tables everything else uses).
9. Census job + registry integration.
