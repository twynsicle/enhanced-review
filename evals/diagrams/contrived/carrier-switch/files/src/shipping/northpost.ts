import { CarrierError, type BookingRequest, type Carrier } from './carrier.ts';

interface NorthpostConsignment {
  consignment_id: string;
  tracking_ref: string;
}

export class NorthpostCarrier implements Carrier {
  readonly name = 'northpost';
  readonly reach = 'domestic';
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
      // The form has no country: Northpost delivers at home only, and is only chosen for it.
      response = await fetch(new URL('/v2/consignments', this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_ref: request.orderId,
          parcels: request.pieces,
          deliver_to: {
            contact: to.name,
            address_lines: [to.line1, to.line2].filter(Boolean),
            town: to.city,
            postcode: to.postcode,
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CarrierError(`northpost unreachable: ${(error as Error).message}`);
    }
    if (!response.ok) throw new CarrierError(`northpost returned ${response.status}`);
    const body = (await response.json()) as NorthpostConsignment;
    if (typeof body.tracking_ref !== 'string' || body.tracking_ref === '') {
      throw new CarrierError('northpost consignment came back without a tracking reference');
    }
    return body.tracking_ref;
  }
}
