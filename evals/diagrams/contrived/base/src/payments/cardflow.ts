import {
  GatewayError,
  type CaptureRequest,
  type CaptureResult,
  type PaymentGateway,
} from './gateway.ts';

interface CardflowCapture {
  id: string;
  status: 'approved' | 'declined';
  decline_reason?: string;
}

export class CardflowGateway implements PaymentGateway {
  private readonly url: string;
  private readonly key: string;
  private readonly timeoutMs: number;

  constructor(url: string, key: string, timeoutMs: number) {
    this.url = url;
    this.key = key;
    this.timeoutMs = timeoutMs;
  }

  async capture(request: CaptureRequest): Promise<CaptureResult> {
    let response: Response;
    try {
      response = await fetch(new URL('/v1/captures', this.url), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.key}`,
          'content-type': 'application/json',
          // Replays of one order's capture must not charge the card twice.
          'idempotency-key': request.merchantReference,
        },
        body: JSON.stringify({
          amount: request.amount,
          currency: request.currency,
          token: request.cardToken,
          reference: request.merchantReference,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new GatewayError(`cardflow unreachable: ${(error as Error).message}`);
    }
    if (!response.ok) throw new GatewayError(`cardflow returned ${response.status}`);
    const body = (await response.json()) as CardflowCapture;
    switch (body.status) {
      case 'approved':
        return { outcome: 'captured', reference: body.id };
      case 'declined':
        return {
          outcome: 'declined',
          reference: body.id,
          reason: body.decline_reason ?? 'declined',
        };
      default:
        throw new GatewayError(`cardflow answered with status ${String(body.status)}`);
    }
  }
}
