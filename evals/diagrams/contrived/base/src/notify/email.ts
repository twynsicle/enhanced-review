export interface Message {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

export class MailerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerError';
  }
}

export class RelayMailer implements Mailer {
  private readonly url: string;
  private readonly from: string;
  private readonly timeoutMs: number;

  constructor(url: string, from: string, timeoutMs: number) {
    this.url = url;
    this.from = from;
    this.timeoutMs = timeoutMs;
  }

  async send(message: Message): Promise<void> {
    let response: Response;
    try {
      response = await fetch(new URL('/messages', this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, ...message }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new MailerError(`relay unreachable: ${(error as Error).message}`);
    }
    if (!response.ok) throw new MailerError(`relay returned ${response.status}`);
  }
}
