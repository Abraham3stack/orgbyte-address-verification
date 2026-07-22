import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetSessions } from '../src/app.js';

describe('Address verification mock API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'));
    resetSessions();
  });

  it('returns 202 for valid initiate request and normalizes country code', async () => {
    const app = createApp();

    const response = await request(app).post('/verify/initiate').send({
      addressLine1: ' 3   Marina   Road ',
      city: ' Lagos ',
      countryCode: 'ng',
      state: '   ',
      postalCode: ' ',
    });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('PENDING');
    expect(response.body.data.pollAfterMs).toBe(1500);
    expect(response.body.data.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const result = await request(app).get(`/verify/result/${response.body.data.sessionId}`);
    vi.setSystemTime(new Date('2026-07-22T10:00:08.000Z'));
    const completed = await request(app).get(`/verify/result/${response.body.data.sessionId}`);

    expect(result.status).toBe(409);
    expect(completed.status).toBe(200);
    expect(completed.body.data.normalizedAddress.countryCode).toBe('NG');
    expect(completed.body.data.normalizedAddress.addressLine1).toBe('3 Marina Road');
    expect(completed.body.data.normalizedAddress.state).toBeUndefined();
    expect(completed.body.data.normalizedAddress.postalCode).toBeUndefined();
  });

  it('returns 400 for invalid initiate input', async () => {
    const app = createApp();

    const response = await request(app).post('/verify/initiate').send({
      addressLine1: 'Valid Address',
      city: 'Test',
      countryCode: 'NGA',
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 for malformed session IDs on status and result', async () => {
    const app = createApp();

    const statusResponse = await request(app).get('/verify/status/not-a-uuid');
    const resultResponse = await request(app).get('/verify/result/not-a-uuid');

    expect(statusResponse.status).toBe(400);
    expect(statusResponse.body.error.code).toBe('INVALID_SESSION_ID');
    expect(resultResponse.status).toBe(400);
    expect(resultResponse.body.error.code).toBe('INVALID_SESSION_ID');
  });

  it('returns 404 for unknown valid session IDs on status and result', async () => {
    const app = createApp();
    const unknownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const statusResponse = await request(app).get(`/verify/status/${unknownId}`);
    const resultResponse = await request(app).get(`/verify/result/${unknownId}`);

    expect(statusResponse.status).toBe(404);
    expect(statusResponse.body.error.code).toBe('SESSION_NOT_FOUND');
    expect(resultResponse.status).toBe(404);
    expect(resultResponse.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('transitions through PENDING, PROCESSING, COMPLETED for non-failure sessions', async () => {
    const app = createApp();

    const initiate = await request(app).post('/verify/initiate').send({
      addressLine1: '3 Marina Road',
      city: 'Lagos',
      countryCode: 'NG',
    });

    const id = initiate.body.data.sessionId;

    vi.setSystemTime(new Date('2026-07-22T10:00:01.000Z'));
    const pending = await request(app).get(`/verify/status/${id}`);

    vi.setSystemTime(new Date('2026-07-22T10:00:03.000Z'));
    const processing = await request(app).get(`/verify/status/${id}`);

    vi.setSystemTime(new Date('2026-07-22T10:00:08.000Z'));
    const completed = await request(app).get(`/verify/status/${id}`);

    expect(pending.body.data.status).toBe('PENDING');
    expect(pending.body.data.progressPercent).toBe(25);
    expect(processing.body.data.status).toBe('PROCESSING');
    expect(processing.body.data.progressPercent).toBe(65);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.progressPercent).toBe(100);
    expect(completed.body.data.nextPollAfterMs).toBeNull();
  });

  it('transitions to FAILED for processing-failure sessions', async () => {
    const app = createApp();

    const initiate = await request(app).post('/verify/initiate').send({
      addressLine1: '410 Test Lane',
      city: 'Sydney',
      state: 'NSW',
      postalCode: '2000',
      countryCode: 'AU',
    });

    const id = initiate.body.data.sessionId;

    vi.setSystemTime(new Date('2026-07-22T10:00:03.000Z'));
    const processing = await request(app).get(`/verify/status/${id}`);

    vi.setSystemTime(new Date('2026-07-22T10:00:06.100Z'));
    const failed = await request(app).get(`/verify/status/${id}`);

    expect(processing.body.data.status).toBe('PROCESSING');
    expect(failed.body.data.status).toBe('FAILED');

    const failedResult = await request(app).get(`/verify/result/${id}`);
    expect(failedResult.status).toBe(409);
    expect(failedResult.body.error.code).toBe('PROCESSING_FAILED');
  });

  it('returns deterministic VERIFIED verdict results', async () => {
    const app = createApp();

    const initiate = await request(app).post('/verify/initiate').send({
      addressLine1: '12 Marina Road',
      city: 'Lagos',
      countryCode: 'ng',
    });

    const id = initiate.body.data.sessionId;
    vi.setSystemTime(new Date('2026-07-22T10:00:08.000Z'));

    const result = await request(app).get(`/verify/result/${id}`);

    expect(result.status).toBe(200);
    expect(result.body.data.verdict).toBe('VERIFIED');
    expect(result.body.data.status).toBe('COMPLETED');
    expect(result.body.data.issues).toEqual([]);
  });

  it('returns deterministic PARTIALLY_VERIFIED verdict results', async () => {
    const app = createApp();

    const initiate = await request(app).post('/verify/initiate').send({
      addressLine1: '200 King Street',
      addressLine2: 'Unit 4',
      city: 'Toronto',
      state: 'ON',
      postalCode: 'M5H 1J9',
      countryCode: 'ca',
    });

    const id = initiate.body.data.sessionId;
    vi.setSystemTime(new Date('2026-07-22T10:00:08.000Z'));

    const result = await request(app).get(`/verify/result/${id}`);

    expect(result.status).toBe(200);
    expect(result.body.data.verdict).toBe('PARTIALLY_VERIFIED');
    expect(result.body.data.issues.some((issue: { code: string }) => issue.code === 'PARTIAL_VERIFICATION')).toBe(
      true,
    );
  });

  it('returns deterministic UNVERIFIED verdict results and stronger severity than partially verified', async () => {
    const app = createApp();

    const initiate = await request(app).post('/verify/initiate').send({
      addressLine1: '1 Mock Failure Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '73301',
      countryCode: 'us',
    });

    const id = initiate.body.data.sessionId;
    vi.setSystemTime(new Date('2026-07-22T10:00:08.000Z'));

    const result = await request(app).get(`/verify/result/${id}`);

    expect(result.status).toBe(200);
    expect(result.body.data.verdict).toBe('UNVERIFIED');
    expect(result.body.data.issues.some((issue: { severity: string }) => issue.severity === 'error')).toBe(true);
  });

  it('returns 409 RESULT_NOT_READY before completion', async () => {
    const app = createApp();

    const initiate = await request(app).post('/verify/initiate').send({
      addressLine1: '12 Marina Road',
      city: 'Lagos',
      countryCode: 'NG',
    });

    const id = initiate.body.data.sessionId;

    vi.setSystemTime(new Date('2026-07-22T10:00:03.000Z'));
    const result = await request(app).get(`/verify/result/${id}`);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('RESULT_NOT_READY');
  });

  it('returns completed negative result with 200', async () => {
    const app = createApp();

    const initiate = await request(app).post('/verify/initiate').send({
      addressLine1: '1 Mock Failure Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '73301',
      countryCode: 'US',
    });

    vi.setSystemTime(new Date('2026-07-22T10:00:08.000Z'));
    const result = await request(app).get(`/verify/result/${initiate.body.data.sessionId}`);

    expect(result.status).toBe(200);
    expect(['PARTIALLY_VERIFIED', 'UNVERIFIED']).toContain(result.body.data.verdict);
  });
});
