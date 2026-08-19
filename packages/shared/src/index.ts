/**
 * @bmi/shared — Public API
 *
 * Re-exports all shared constants, types, and utilities.
 * Import from '@bmi/shared' in all consuming repos.
 */

// Program catalog
export type { Program, ProgramLevel } from './programs.js';
export { PROGRAMS, VALID_PROGRAMS, VALID_LEVELS } from './programs.js';

// Domain constants
export {
  PORTAL_URL,
  UMS_URL,
  UMS_PAGES_URL,
  MARKETING_URL,
  MARKETING_URL_WWW,
  PORTAL_PAGES_URL,
  UNIVERSITY_PAGES_URL,
  API_WORKER_URL,
  VERIFY_URL,
  ADMIN_URL,
  APPLY_URL,
  DEV_ORIGINS,
  ALLOWED_ORIGINS,
  ADMISSIONS_EMAIL,
  REGISTRAR_EMAIL,
  ADMIN_EMAIL,
  SUPPORT_EMAIL,
  NOREPLY_EMAIL,
  SECURITY_EMAIL,
  FINANCE_EMAIL,
  ALUMNI_EMAIL,
} from './domains.js';

// Brand design tokens
export type { BrandColorKey } from './tokens.js';
export { BrandColors } from './tokens.js';

// API contract types
export type {
  ApiSuccess,
  ApiFailure,
  ApiResponse,
  // Standard pagination — use these everywhere, not inline definitions
  PaginatedData,
  PaginatedResponse,
  RegisterRequest,
  RegisterSuccessData,
  RegisterSuccessResponse,
  AccountAlreadyExistsError,
  RegisterResponse,
  LoginRequest,
  LoginSuccessData,
  LoginSuccessResponse,
  LoginResponse,
  RefreshSuccessData,
  RefreshSuccessResponse,
  RefreshResponse,
  // Public API types
  PublicProgramResponse,
  PublicStatsResponse,
  CmsPostSummary,
  CmsPostFull,
  CmsPageContent,
  WebhookEventType,
  WebhookEvent,
} from './api-types.js';
export { API_STATUS } from './api-types.js';

// Grading logic
export { calculateGrade, percentageToGrade } from './grading.js';
