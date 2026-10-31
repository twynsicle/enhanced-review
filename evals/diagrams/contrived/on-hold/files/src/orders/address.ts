import type { Address } from './order.ts';

export class AddressError extends Error {
  readonly field: keyof Address;

  constructor(field: keyof Address, message: string) {
    super(`${field}: ${message}`);
    this.name = 'AddressError';
    this.field = field;
  }
}

const POSTCODES: Record<string, RegExp> = {
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/,
  IE: /^[A-Z]\d{2} ?[A-Z\d]{4}$/,
  DE: /^\d{5}$/,
  NL: /^\d{4} ?[A-Z]{2}$/,
  FR: /^\d{5}$/,
  US: /^\d{5}(-\d{4})?$/,
};

export const COUNTRIES: readonly string[] = Object.keys(POSTCODES);

const REQUIRED: readonly (keyof Address)[] = ['name', 'line1', 'city', 'postcode', 'country'];

/**
 * Checks the shape of an address, not that it exists: the carrier rejects a
 * postcode it cannot route at booking time, and by then the order is paid.
 * Catching the shape here keeps a typo from reaching the gateway at all.
 */
export function validateAddress(address: Address): Address {
  for (const field of REQUIRED) {
    const value = address[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AddressError(field, 'is required');
    }
  }
  const country = address.country.trim().toUpperCase();
  const pattern = POSTCODES[country];
  if (!pattern) throw new AddressError('country', `${address.country} is not shipped to`);
  const postcode = address.postcode.trim().toUpperCase();
  if (!pattern.test(postcode)) {
    throw new AddressError('postcode', `${address.postcode} is not a ${country} postcode`);
  }
  return { ...address, country, postcode };
}

const PO_BOX = /\bP\.? ?O\.? ?BOX\b/i;

/**
 * Where the carrier's own network stops. A PO box belongs to the postal
 * service, and in these countries the carrier hands nothing over to it; the
 * postcode prefixes are the islands and territories it has no route into.
 */
const NO_PO_BOX: readonly string[] = ['US', 'FR'];

const UNSERVED: Record<string, readonly string[]> = {
  GB: ['GY', 'JE', 'IM'],
  US: ['967', '968', '995', '996', '997', '998', '999'],
  FR: ['97', '98'],
};

export type Deliverability = { deliverable: true } | { deliverable: false; reason: string };

/** Expects an address validateAddress has shaped: country and postcode already upper-cased. */
export function checkDeliverable(address: Address): Deliverability {
  const { country, postcode } = address;
  if (NO_PO_BOX.includes(country) && [address.line1, address.line2 ?? ''].some(isPoBox)) {
    return { deliverable: false, reason: `the carrier does not deliver to a PO box in ${country}` };
  }
  const district = UNSERVED[country]?.find((prefix) => postcode.startsWith(prefix));
  if (district) {
    return {
      deliverable: false,
      reason: `the carrier has no route to ${country} postcodes beginning ${district}`,
    };
  }
  return { deliverable: true };
}

function isPoBox(line: string): boolean {
  return PO_BOX.test(line);
}
