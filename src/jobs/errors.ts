/** Thrown by a job when its command-line arguments are unusable (exit code 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
