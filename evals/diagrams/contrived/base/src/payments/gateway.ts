export interface CaptureRequest {
  amount: number;
  currency: string;
  cardToken: string;
  /** The order id, so the gateway's later notices can be matched back to it. */
  merchantReference: string;
}

export type CaptureResult =
  | { outcome: 'captured'; reference: string }
  | { outcome: 'declined'; reference: string; reason: string };

export interface PaymentGateway {
  capture(request: CaptureRequest): Promise<CaptureResult>;
}

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}
