import { z } from 'zod';

export const SESSION_ID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const POLL_AFTER_MS = 1500;

export type SessionState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type VerificationVerdict = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED';

const collapseWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ');

const requiredString = (min: number, max: number) =>
  z
    .string({ error: 'Expected string' })
    .transform(collapseWhitespace)
    .refine((value) => value.length >= min && value.length <= max, {
      error: `Must be between ${min} and ${max} characters`,
    });

const optionalString = (min: number, max: number) =>
  z
    .string({ error: 'Expected string' })
    .transform(collapseWhitespace)
    .optional()
    .transform((value) => {
      if (value === undefined || value.length === 0) {
        return undefined;
      }

      return value;
    })
    .refine((value) => value === undefined || (value.length >= min && value.length <= max), {
      error: `Must be between ${min} and ${max} characters when provided`,
    });

export const addressInputSchema =
  z
    .object({
      addressLine1: requiredString(1, 120),
      addressLine2: optionalString(1, 120),
      city: requiredString(1, 80),
      state: optionalString(2, 80),
      postalCode: optionalString(3, 20),
      countryCode: z
        .string({ error: 'Expected string' })
        .transform(collapseWhitespace)
        .refine((value) => /^[A-Za-z]{2}$/.test(value), {
          error: 'Must be a 2-letter country code',
        })
        .transform((value) => value.toUpperCase()),
    })
    .strict();

export type AddressInput = z.infer<typeof addressInputSchema>;

export type SessionRecord = {
  sessionId: string;
  createdAtMs: number;
  createdAtIso: string;
  input: AddressInput;
  asciiSum: number;
  processingFailure: boolean;
  verdict: VerificationVerdict;
};

export const toSeed = (input: AddressInput): string => {
  return [
    input.addressLine1,
    input.addressLine2 ?? '',
    input.city,
    input.state ?? '',
    input.postalCode ?? '',
    input.countryCode,
  ].join('|');
};

export const toAsciiSum = (seed: string): number => {
  let total = 0;

  for (const char of seed) {
    total += char.charCodeAt(0);
  }

  return total;
};

export const toVerdict = (asciiSum: number): VerificationVerdict => {
  const verdictKey = asciiSum % 3;

  if (verdictKey === 0) {
    return 'VERIFIED';
  }

  if (verdictKey === 1) {
    return 'PARTIALLY_VERIFIED';
  }

  return 'UNVERIFIED';
};

export const isProcessingFailure = (asciiSum: number): boolean => {
  const processingFailureKey = asciiSum % 10;
  return processingFailureKey === 0 || processingFailureKey === 1;
};

export const toSessionState = (session: SessionRecord, nowMs: number): SessionState => {
  const elapsedMs = Math.max(0, nowMs - session.createdAtMs);

  if (session.processingFailure) {
    if (elapsedMs < 2000) {
      return 'PENDING';
    }

    if (elapsedMs < 6000) {
      return 'PROCESSING';
    }

    return 'FAILED';
  }

  if (elapsedMs < 2000) {
    return 'PENDING';
  }

  if (elapsedMs < 7000) {
    return 'PROCESSING';
  }

  return 'COMPLETED';
};

export const toProgressPercent = (state: SessionState): 25 | 65 | 100 => {
  if (state === 'PENDING') {
    return 25;
  }

  if (state === 'PROCESSING') {
    return 65;
  }

  return 100;
};

export const supportedCountries = new Set(['US', 'CA', 'GB', 'AU', 'NG']);

export const buildFormattedAddress = (input: AddressInput): string => {
  const parts = [
    input.addressLine1,
    input.addressLine2,
    input.city,
    input.state,
    input.postalCode,
    input.countryCode,
  ].filter((value) => Boolean(value));

  return parts.join(', ');
};

export const toConfidenceScore = (asciiSum: number): number => {
  const raw = Math.min(0.99, 0.7 + (asciiSum % 31) / 100);
  return Number(raw.toFixed(2));
};

export type ApiIssue = {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
};

export const buildIssues = (input: AddressInput, verdict: VerificationVerdict): ApiIssue[] => {
  const issues: ApiIssue[] = [];
  const countrySupported = supportedCountries.has(input.countryCode);

  if (!countrySupported) {
    issues.push({
      code: 'COUNTRY_UNSUPPORTED',
      message: 'Country is accepted but not fully supported in mock checks',
      severity: 'warning',
    });
  }

  // Keep session state and verification verdict distinct while ensuring
  // UNVERIFIED communicates stronger severity than PARTIALLY_VERIFIED.
  if (verdict === 'PARTIALLY_VERIFIED') {
    issues.push({
      code: 'PARTIAL_VERIFICATION',
      message: 'Address verification completed with partial confidence',
      severity: 'warning',
    });
  }

  if (verdict === 'UNVERIFIED') {
    issues.push({
      code: 'ADDRESS_UNVERIFIED',
      message: 'Address verification completed with unresolved verification signals',
      severity: 'error',
    });
  }

  return issues;
};

export const toErrorResponse = (
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): {
  success: false;
  data: null;
  error: { code: string; message: string; details?: unknown };
  meta: { requestId: string; timestamp: string };
} => {
  const error: { code: string; message: string; details?: unknown } = { code, message };

  if (details !== undefined) {
    error.details = details;
  }

  return {
    success: false,
    data: null,
    error,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
};
