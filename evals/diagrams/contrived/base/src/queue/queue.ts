import { randomUUID } from 'node:crypto';
import type { Job } from './jobs.ts';

export interface Envelope {
  id: string;
  job: Job;
  attempts: number;
}

export interface Queue {
  enqueue(job: Job): Promise<void>;
  /** The next job, now in flight until it is acked or released. */
  take(): Promise<Envelope | null>;
  ack(id: string): Promise<void>;
  /** Back on the queue, at the end, with its attempt count kept. */
  release(id: string): Promise<void>;
  size(): Promise<number>;
}

export class MemoryQueue implements Queue {
  private readonly ready: Envelope[] = [];
  private readonly inFlight = new Map<string, Envelope>();

  enqueue(job: Job): Promise<void> {
    this.ready.push({ id: randomUUID(), job, attempts: 0 });
    return Promise.resolve();
  }

  take(): Promise<Envelope | null> {
    const envelope = this.ready.shift();
    if (!envelope) return Promise.resolve(null);
    envelope.attempts += 1;
    this.inFlight.set(envelope.id, envelope);
    return Promise.resolve(envelope);
  }

  ack(id: string): Promise<void> {
    if (!this.inFlight.delete(id)) return Promise.reject(new Error(`job ${id} is not in flight`));
    return Promise.resolve();
  }

  release(id: string): Promise<void> {
    const envelope = this.inFlight.get(id);
    if (!envelope) return Promise.reject(new Error(`job ${id} is not in flight`));
    this.inFlight.delete(id);
    this.ready.push(envelope);
    return Promise.resolve();
  }

  size(): Promise<number> {
    return Promise.resolve(this.ready.length + this.inFlight.size);
  }
}
