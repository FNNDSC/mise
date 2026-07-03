/**
 * @file Tests for plugin-instance (job) status, cancellation and log
 * streaming, with the connection mocked at the client boundary.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { ChRISJob, JobStatus } from '../src/jobs/chrisJob';
import { errorStack } from '../src/error/errorStack';
import { Result } from '../src/utils/result';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

interface InstancePayload {
  plugin_name: string;
  status: string;
  start_date: string;
  started_date?: string;
  finished_date?: string;
  error_message?: string;
}

const instance = (payload: Partial<InstancePayload>): { data: InstancePayload } => ({
  data: {
    plugin_name: 'pl-dircopy',
    status: 'running',
    start_date: '2026-07-01T10:00:00',
    ...payload,
  },
});

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
});

describe('ChRISJob.status_get', () => {
  it('maps the instance payload onto a JobStatus', async () => {
    mockClientGet.mockResolvedValue({
      getPluginInstance: jest.fn(async () => instance({
        status: 'completed',
        started_date: '2026-07-01T10:01:00',
        finished_date: '2026-07-01T10:05:00',
      })),
    });
    const result: Result<JobStatus> = await new ChRISJob('42').status_get();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('42');
      expect(result.value.pluginName).toBe('pl-dircopy');
      expect(result.value.state).toBe('completed');
      expect(result.value.progress).toBe(100);
      expect(result.value.startedAt).toEqual(new Date('2026-07-01T10:01:00'));
      expect(result.value.finishedAt).toEqual(new Date('2026-07-01T10:05:00'));
      expect(result.value.error).toBeNull();
    }
  });

  it.each([
    ['scheduled', 0],
    ['registering_files', 5],
    ['started', 10],
    ['running', 50],
    ['error', 100],
    ['cancelled', 100],
    ['waiting', 0],
  ])('estimates progress for state %s as %i', async (status: string, progress: number) => {
    mockClientGet.mockResolvedValue({
      getPluginInstance: jest.fn(async () => instance({ status, error_message: status === 'error' ? 'died' : undefined })),
    });
    const result: Result<JobStatus> = await new ChRISJob('1').status_get();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.progress).toBe(progress);
  });

  it('surfaces the instance error message', async () => {
    mockClientGet.mockResolvedValue({
      getPluginInstance: jest.fn(async () => instance({ status: 'error', error_message: 'segfault' })),
    });
    const result: Result<JobStatus> = await new ChRISJob('1').status_get();
    if (result.ok) expect(result.value.error).toBe('segfault');
  });

  it('errors when the instance has no data', async () => {
    mockClientGet.mockResolvedValue({ getPluginInstance: jest.fn(async () => ({})) });
    expect((await new ChRISJob('9').status_get()).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Job 9 not found'));
  });

  it('errors when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await new ChRISJob('9').status_get()).ok).toBe(false);
  });

  it('errors when the client call throws', async () => {
    mockClientGet.mockResolvedValue({ getPluginInstance: jest.fn(async () => { throw new Error('504'); }) });
    expect((await new ChRISJob('9').status_get()).ok).toBe(false);
  });
});

describe('ChRISJob.cancel', () => {
  it('puts a cancelled status on the instance', async () => {
    const put = jest.fn(async () => ({}));
    mockClientGet.mockResolvedValue({ getPluginInstance: jest.fn(async () => ({ ...instance({}), put })) });
    const result: Result<boolean> = await new ChRISJob('42').cancel();
    expect(result.ok).toBe(true);
    expect(put).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('errors when the instance is missing', async () => {
    mockClientGet.mockResolvedValue({ getPluginInstance: jest.fn(async () => null) });
    expect((await new ChRISJob('42').cancel()).ok).toBe(false);
  });

  it('errors when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await new ChRISJob('42').cancel()).ok).toBe(false);
  });

  it('errors when the put throws', async () => {
    mockClientGet.mockResolvedValue({
      getPluginInstance: jest.fn(async () => ({ ...instance({}), put: jest.fn(async () => { throw new Error('403'); }) })),
    });
    expect((await new ChRISJob('42').cancel()).ok).toBe(false);
  });
});

describe('ChRISJob.logs_stream', () => {
  it('terminates immediately for a completed job', async () => {
    mockClientGet.mockResolvedValue({
      getPluginInstance: jest.fn(async () => instance({ status: 'completed' })),
    });
    const chunks: string[] = [];
    for await (const chunk of new ChRISJob('42').logs_stream()) chunks.push(chunk);
    expect(chunks).toEqual([]);
  });

  it('terminates when the instance disappears', async () => {
    mockClientGet.mockResolvedValue({ getPluginInstance: jest.fn(async () => ({})) });
    const chunks: string[] = [];
    for await (const chunk of new ChRISJob('42').logs_stream()) chunks.push(chunk);
    expect(chunks).toEqual([]);
  });

  it('returns without streaming when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    const chunks: string[] = [];
    for await (const chunk of new ChRISJob('42').logs_stream()) chunks.push(chunk);
    expect(chunks).toEqual([]);
    expect(pushSpy).toHaveBeenCalledWith('error', 'Not connected to ChRIS');
  });
});
