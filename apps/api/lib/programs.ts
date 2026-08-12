/**
 * Program catalog access — DB-AS-SSOT (Single Source of Truth).
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURAL PRINCIPLE: The database `programs` table is the        ║
 * ║  canonical single source of truth for all program metadata.           ║
 * ║                                                                        ║
 * ║  — NEVER add new program data to the hardcoded @bmi/shared array.     ║
 * ║  — ALWAYS query the DB for programs, faculties, and departments.     ║
 * ║  — Frontend consumers should call /api/public/programs and fall back  ║
 * ║    to FALLBACK_PROGRAMS only for first-paint hydration.              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Authoritative endpoints (DB-backed via SQL in routes/public.ts):
 *   GET /api/public/programs    — paginated catalog with seat availability
 *   GET /api/public/faculties   — active faculties for marketing dropdowns
 *   GET /api/public/departments — departments (optionally filtered by faculty)
 *
 * Server-side validation helper (for application submissions):
 *   isValidProgramName(env, programName) — defined in routes/apply.ts
 *   queries the DB directly so UMS program edits are reflected instantly.
 *
 * This module's re-exports from @bmi/shared are preserved for:
 *   1. Backward compatibility with any remaining legacy imports
 *   2. Frontend fallback data (FALLBACK_PROGRAMS) used during progressive
 *      hydration so components render instantly without waiting on the API
 *   3. Type imports (Program, ProgramLevel) used by both layers
 *
 * G-2 fix: duplicated program catalog removed from this file.
 * G-3 fix: VALID_PROGRAMS / program validation now sourced from DB.
 */
export type { Program, ProgramLevel } from '@bmi/shared';
export { PROGRAMS as FALLBACK_PROGRAMS, VALID_LEVELS } from '@bmi/shared';
