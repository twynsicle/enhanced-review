import type { Address } from '../orders/order.ts';
import { CarrierError, type Carrier, type Reach } from './carrier.ts';

/**
 * A parcel for the home country goes to the domestic carrier, everything else
 * to the international one. A home-country parcel is never handed to the
 * international carrier as a fallback: its domestic rate is the one this
 * split exists to stop paying, so a setup with no domestic carrier should
 * fail on its first order rather than book quietly at the old price.
 */
export function chooseCarrier(carriers: Carrier[], address: Address, homeCountry: string): Carrier {
  const reach: Reach = address.country === homeCountry ? 'domestic' : 'international';
  const carrier = carriers.find((candidate) => candidate.reach === reach);
  if (!carrier) throw new CarrierError(`no ${reach} carrier to send ${address.country} with`);
  return carrier;
}
