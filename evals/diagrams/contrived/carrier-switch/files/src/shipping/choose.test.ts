import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Address } from '../orders/order.ts';
import { CarrierError, type Carrier, type Reach } from './carrier.ts';
import { chooseCarrier } from './choose.ts';

const leeds: Address = {
  name: 'Ana Costa',
  line1: '1 High St',
  city: 'Leeds',
  postcode: 'LS1 4AP',
  country: 'GB',
};

function carrier(name: string, reach: Reach): Carrier {
  return { name, reach, book: () => Promise.reject(new Error(`${name} is not booked here`)) };
}

const northpost = carrier('northpost', 'domestic');
const parcelnet = carrier('parcelnet', 'international');

describe('chooseCarrier', () => {
  it('sends a home-country parcel with the domestic carrier', () => {
    assert.equal(chooseCarrier([parcelnet, northpost], leeds, 'GB'), northpost);
  });

  it('sends everything else with the international carrier', () => {
    const berlin = { ...leeds, country: 'DE', postcode: '10117' };
    assert.equal(chooseCarrier([northpost, parcelnet], berlin, 'GB'), parcelnet);
  });

  it('takes the home country from the setup, not from the carrier', () => {
    const dublin = { ...leeds, country: 'IE', postcode: 'D02 X285' };
    assert.equal(chooseCarrier([northpost, parcelnet], dublin, 'IE'), northpost);
    assert.equal(chooseCarrier([northpost, parcelnet], leeds, 'IE'), parcelnet);
  });

  it('refuses rather than book with a carrier that does not go there', () => {
    const berlin = { ...leeds, country: 'DE', postcode: '10117' };
    assert.throws(() => chooseCarrier([northpost], berlin, 'GB'), CarrierError);
    assert.throws(() => chooseCarrier([parcelnet], leeds, 'GB'), CarrierError);
  });
});
