import { JobMonitor, jobMonitor_get } from '../src/jobs/jobMonitor';
import { ChRISJob, JobStatus, JobState } from '../src/jobs/chrisJob';
import { Ok, Err, Result } from '../src/utils/result';

function status(state: JobState): JobStatus {
  return {
    id: '1',
    pluginName: 'pl-test',
    state,
    progress: 0,
    createdAt: new Date(0),
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

/** Reset the shared singleton's private state so each test is isolated. */
function resetMonitor(m: JobMonitor): void {
  const priv = m as unknown as {
    callbacks: unknown[];
    watchedJobs: Map<string, unknown>;
    polling_stop(): void;
  };
  priv.polling_stop();
  priv.callbacks.length = 0;
  priv.watchedJobs.clear();
}

describe('JobMonitor', () => {
  let monitor: JobMonitor;

  beforeEach(() => {
    jest.useFakeTimers();
    monitor = jobMonitor_get();
    resetMonitor(monitor);
  });

  afterEach(() => {
    resetMonitor(monitor);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('jobMonitor_get and instance_get return the same singleton', () => {
    expect(jobMonitor_get()).toBe(monitor);
    expect(JobMonitor.instance_get()).toBe(monitor);
  });

  it('watch registers a job and watchedJobs_get reports it', () => {
    monitor.watch('42');
    expect(monitor.watchedJobs_get()).toEqual([{ id: '42', progress: 0 }]);
  });

  it('fires callbacks when a watched job changes state', async () => {
    jest.spyOn(ChRISJob.prototype, 'status_get').mockResolvedValue(Ok(status('running')));
    const seen: Array<[string, JobState]> = [];
    monitor.onChange((id, s) => seen.push([id, s.state]));

    monitor.watch('1');
    await jest.advanceTimersByTimeAsync(10000);

    expect(seen).toEqual([['1', 'running']]);
  });

  it('does not fire when the state is unchanged from the initial "scheduled"', async () => {
    jest.spyOn(ChRISJob.prototype, 'status_get').mockResolvedValue(Ok(status('scheduled')));
    const cb = jest.fn();
    monitor.onChange(cb);

    monitor.watch('1');
    await jest.advanceTimersByTimeAsync(10000);

    expect(cb).not.toHaveBeenCalled();
  });

  it('auto-unwatches a job that reaches a terminal state', async () => {
    jest.spyOn(ChRISJob.prototype, 'status_get').mockResolvedValue(Ok(status('completed')));
    monitor.onChange(() => undefined);

    monitor.watch('1');
    expect(monitor.watchedJobs_get()).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(10000);

    expect(monitor.watchedJobs_get()).toHaveLength(0);
  });

  it('skips jobs whose status fetch fails', async () => {
    jest
      .spyOn(ChRISJob.prototype, 'status_get')
      .mockResolvedValue(Err() as Result<JobStatus>);
    const cb = jest.fn();
    monitor.onChange(cb);

    monitor.watch('1');
    await jest.advanceTimersByTimeAsync(10000);

    expect(cb).not.toHaveBeenCalled();
    expect(monitor.watchedJobs_get()).toHaveLength(1); // still watched
  });

  it('unwatch removes a job and stops polling when none remain', async () => {
    const statusSpy = jest
      .spyOn(ChRISJob.prototype, 'status_get')
      .mockResolvedValue(Ok(status('running')));

    monitor.watch('1');
    monitor.unwatch('1');
    expect(monitor.watchedJobs_get()).toHaveLength(0);

    // Polling stopped: advancing the clock triggers no further status fetches.
    await jest.advanceTimersByTimeAsync(30000);
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('watching twice does not start a second interval', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    monitor.watch('1');
    monitor.watch('2');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
