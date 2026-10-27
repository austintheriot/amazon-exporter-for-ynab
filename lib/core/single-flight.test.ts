import { describe, expect, it } from 'vitest';
import { createSingleFlight } from './single-flight';

describe('createSingleFlight', () => {
  it('refuses a second job while the first runs', async () => {
    const flight = createSingleFlight();
    let release: () => void = () => undefined;
    const first = flight.run(() => new Promise<void>((resolve) => (release = resolve)));
    expect(first).not.toBeNull();
    expect(flight.run(() => Promise.resolve())).toBeNull();
    release();
    await first;
  });

  it('accepts a job after the first settles', async () => {
    const flight = createSingleFlight();
    await flight.run(() => Promise.resolve());
    expect(flight.run(() => Promise.resolve())).not.toBeNull();
  });

  it('accepts a job after the first rejects', async () => {
    const flight = createSingleFlight();
    await flight.run(() => Promise.reject(new Error('boom')))?.catch(() => undefined);
    expect(flight.run(() => Promise.resolve())).not.toBeNull();
  });
});
