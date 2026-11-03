import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AddressError, checkDeliverable, validateAddress } from './address.ts';
import type { Address } from './order.ts';

const leeds: Address = {
  name: 'Ana Costa',
  line1: '1 High St',
  city: 'Leeds',
  postcode: 'LS1 4AP',
  country: 'GB',
};

function field(expected: keyof Address) {
  return (error: unknown) => error instanceof AddressError && error.field === expected;
}

describe('validateAddress', () => {
  it('accepts a complete address', () => {
    assert.deepEqual(validateAddress(leeds), leeds);
  });

  it('upper-cases the country and postcode it hands back', () => {
    const checked = validateAddress({ ...leeds, country: 'gb', postcode: 'ls1 4ap' });
    assert.equal(checked.country, 'GB');
    assert.equal(checked.postcode, 'LS1 4AP');
  });

  it('names the line that is missing', () => {
    assert.throws(() => validateAddress({ ...leeds, line1: '  ' }), field('line1'));
  });

  it('names the postcode when it is not the shape the country uses', () => {
    assert.throws(() => validateAddress({ ...leeds, postcode: '90210' }), field('postcode'));
    const berlin = { ...leeds, country: 'DE', postcode: 'LS1 4AP' };
    assert.throws(() => validateAddress(berlin), field('postcode'));
  });

  it('names the country when it is not one shipped to', () => {
    assert.throws(() => validateAddress({ ...leeds, country: 'AU' }), field('country'));
  });

  it('accepts each country it ships to', () => {
    const postcodes: Record<string, string> = {
      IE: 'D02 X285',
      DE: '10115',
      NL: '1012 AB',
      FR: '75001',
      US: '10001-1234',
    };
    for (const [country, postcode] of Object.entries(postcodes)) {
      assert.equal(validateAddress({ ...leeds, country, postcode }).country, country);
    }
  });
});

describe('checkDeliverable', () => {
  const newYork = { ...leeds, city: 'New York', postcode: '10001', country: 'US' };

  it('passes an address on the carrier network', () => {
    assert.deepEqual(checkDeliverable(leeds), { deliverable: true });
    assert.deepEqual(checkDeliverable(newYork), { deliverable: true });
  });

  it('refuses a PO box where the carrier hands nothing to the postal service', () => {
    assert.deepEqual(checkDeliverable({ ...newYork, line1: 'P.O. Box 310' }), {
      deliverable: false,
      reason: 'the carrier does not deliver to a PO box in US',
    });
    assert.equal(checkDeliverable({ ...newYork, line2: 'PO Box 9' }).deliverable, false);
  });

  it('delivers to a PO box in a country where it carries to the box itself', () => {
    assert.equal(checkDeliverable({ ...leeds, line1: 'PO Box 12' }).deliverable, true);
  });

  it('refuses a postcode in a district the carrier has no route into', () => {
    const guernsey = { ...leeds, city: 'St Peter Port', postcode: 'GY1 1AA' };
    assert.deepEqual(checkDeliverable(guernsey), {
      deliverable: false,
      reason: 'the carrier has no route to GB postcodes beginning GY',
    });
    const honolulu = { ...newYork, city: 'Honolulu', postcode: '96813' };
    assert.equal(checkDeliverable(honolulu).deliverable, false);
  });
});
