import { describe, expect, it, vi } from 'vitest';
import { createLatestPublisher } from './latest-publisher';

describe('animated hit geometry IPC', () => {
  it('never sends concurrent snapshots and keeps the final collapse frame', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const applied: number[] = [];
    const send = vi.fn(async (width: number) => { if (width === 412) await gate; applied.push(width); });
    const publish = createLatestPublisher(send);
    const first = publish(412);
    await publish(310); await publish(180); await publish(60);
    expect(send).toHaveBeenCalledTimes(1);
    release(); await first;
    expect(applied).toEqual([412,60]);
  });

  it('still publishes the newest frame when an earlier request fails', async () => {
    let reject!: (error: Error) => void;
    const gate = new Promise<void>((_,fail) => { reject = fail; });
    const send = vi.fn().mockImplementationOnce(() => gate).mockResolvedValue(undefined);
    const publish = createLatestPublisher<number>(send);
    const first = publish(412); await publish(60);
    reject(new Error('old IPC failed')); await first;
    expect(send.mock.calls.map(([value])=>value)).toEqual([412,60]);
  });

  it('recovers for later updates after the last request fails', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('IPC failed')).mockResolvedValue(undefined);
    const publish = createLatestPublisher<number>(send);
    await expect(publish(412)).rejects.toThrow('IPC failed');
    await publish(60);
    expect(send).toHaveBeenLastCalledWith(60);
  });
});
