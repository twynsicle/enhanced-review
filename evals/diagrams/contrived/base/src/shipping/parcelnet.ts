import { CarrierError, type BookingRequest, type Carrier } from './carrier.ts';

interface ParcelnetBooking {
  tracking: string;
}

export class ParcelnetCarrier implements Carrier {
  readonly name = 'parcelnet';
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  async book(request: BookingRequest): Promise<string> {
    const { to } = request;
    let response: Response;
    try {
      response = await fetch(new URL('/bookings', this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reference: request.orderId,
          service: to.country === 'GB' ? 'standard' : 'international',
          pieces: request.pieces,
          recipient: {
            name: to.name,
            lines: [to.line1, to.line2].filter(Boolean),
            city: to.city,
            postcode: to.postcode,
            country: to.country,
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CarrierError(`parcelnet unreachable: ${(error as Error).message}`);
    }
    if (!response.ok) throw new CarrierError(`parcelnet returned ${response.status}`);
    const body = (await response.json()) as ParcelnetBooking;
    if (typeof body.tracking !== 'string' || body.tracking === '') {
      throw new CarrierError('parcelnet booking came back without a tracking number');
    }
    return body.tracking;
  }
}
