import express, { type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  POLL_AFTER_MS,
  SESSION_ID_V4_REGEX,
  addressInputSchema,
  buildFormattedAddress,
  buildIssues,
  isProcessingFailure,
  supportedCountries,
  toAsciiSum,
  toConfidenceScore,
  toErrorResponse,
  toProgressPercent,
  toSeed,
  toSessionState,
  toVerdict,
  type SessionRecord,
} from './domain.js';

export type AppDependencies = {
  now?: () => number;
};

const sessions = new Map<string, SessionRecord>();

const newRequestId = (): string => `req_${uuidv4().replace(/-/g, '')}`;

const sendValidationError = (res: Response, requestId: string, details: unknown): void => {
  res.status(400).json(toErrorResponse('INVALID_REQUEST', 'Request validation failed', requestId, details));
};

const isValidSessionId = (sessionId: string): boolean => SESSION_ID_V4_REGEX.test(sessionId);

export const createApp = (deps: AppDependencies = {}) => {
  const now = deps.now ?? (() => Date.now());
  const app = express();

  app.use(express.json());

  app.post('/verify/initiate', (req: Request, res: Response) => {
    const requestId = newRequestId();
    const parsed = addressInputSchema.safeParse(req.body);

    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        issue: issue.message,
      }));

      sendValidationError(res, requestId, details);
      return;
    }

    const normalizedInput = parsed.data;
    const seed = toSeed(normalizedInput);
    const asciiSum = toAsciiSum(seed);
    const processingFailure = isProcessingFailure(asciiSum);
    const verdict = toVerdict(asciiSum);
    const createdAtMs = now();
    const createdAtIso = new Date(createdAtMs).toISOString();

    const sessionId = uuidv4();
    sessions.set(sessionId, {
      sessionId,
      createdAtMs,
      createdAtIso,
      input: normalizedInput,
      asciiSum,
      processingFailure,
      verdict,
    });

    res.status(202).json({
      success: true,
      data: {
        sessionId,
        status: 'PENDING',
        createdAt: createdAtIso,
        pollAfterMs: POLL_AFTER_MS,
      },
      error: null,
      meta: {
        requestId,
        timestamp: new Date(now()).toISOString(),
      },
    });
  });

  app.get('/verify/status/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
    const requestId = newRequestId();
    const { sessionId } = req.params;

    if (!isValidSessionId(sessionId)) {
      res
        .status(400)
        .json(toErrorResponse('INVALID_SESSION_ID', 'sessionId must be a valid UUID v4', requestId));
      return;
    }

    const session = sessions.get(sessionId);

    if (!session) {
      res
        .status(404)
        .json(
          toErrorResponse(
            'SESSION_NOT_FOUND',
            'No verification session exists for the provided sessionId',
            requestId,
          ),
        );
      return;
    }

    const currentState = toSessionState(session, now());
    const isTerminal = currentState === 'COMPLETED' || currentState === 'FAILED';

    res.status(200).json({
      success: true,
      data: {
        sessionId,
        status: currentState,
        createdAt: session.createdAtIso,
        updatedAt: new Date(now()).toISOString(),
        isTerminal,
        progressPercent: toProgressPercent(currentState),
        nextPollAfterMs: isTerminal ? null : POLL_AFTER_MS,
      },
      error: null,
      meta: {
        requestId,
        timestamp: new Date(now()).toISOString(),
      },
    });
  });

  app.get('/verify/result/:sessionId', (req: Request<{ sessionId: string }>, res: Response) => {
    const requestId = newRequestId();
    const { sessionId } = req.params;

    if (!isValidSessionId(sessionId)) {
      res
        .status(400)
        .json(toErrorResponse('INVALID_SESSION_ID', 'sessionId must be a valid UUID v4', requestId));
      return;
    }

    const session = sessions.get(sessionId);

    if (!session) {
      res
        .status(404)
        .json(
          toErrorResponse(
            'SESSION_NOT_FOUND',
            'No verification session exists for the provided sessionId',
            requestId,
          ),
        );
      return;
    }

    const currentState = toSessionState(session, now());

    if (currentState === 'PENDING' || currentState === 'PROCESSING') {
      res.status(409).json(toErrorResponse('RESULT_NOT_READY', 'Verification is still in progress', requestId));
      return;
    }

    if (currentState === 'FAILED') {
      res
        .status(409)
        .json(
          toErrorResponse(
            'PROCESSING_FAILED',
            'Verification processing failed and no final result is available',
            requestId,
          ),
        );
      return;
    }

    const countrySupported = supportedCountries.has(session.input.countryCode);
    const resultIssues = buildIssues(session.input, session.verdict);

    res.status(200).json({
      success: true,
      data: {
        sessionId,
        status: 'COMPLETED',
        verdict: session.verdict,
        completedAt: new Date(session.createdAtMs + 7000).toISOString(),
        normalizedAddress: {
          addressLine1: session.input.addressLine1,
          ...(session.input.addressLine2 ? { addressLine2: session.input.addressLine2 } : {}),
          city: session.input.city,
          ...(session.input.state ? { state: session.input.state } : {}),
          ...(session.input.postalCode ? { postalCode: session.input.postalCode } : {}),
          countryCode: session.input.countryCode,
          formattedAddress: buildFormattedAddress(session.input),
        },
        confidenceScore: toConfidenceScore(session.asciiSum),
        checks: {
          addressLine1Valid: true,
          postalCodeValid:
            session.input.postalCode === undefined ? true : session.input.postalCode.length >= 3,
          cityStateMatch: true,
          countrySupported,
        },
        issues: resultIssues,
      },
      error: null,
      meta: {
        requestId,
        timestamp: new Date(now()).toISOString(),
      },
    });
  });

  return app;
};

export const resetSessions = (): void => {
  sessions.clear();
};
