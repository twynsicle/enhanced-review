import type { OrderLine } from './order.ts';

export const CURRENCY = 'GBP';

export interface Price {
  subtotal: number;
  shipping: number;
  total: number;
}

const SHIPPING: Record<string, number> = {
  GB: 395,
  IE: 795,
  DE: 995,
  NL: 995,
  FR: 995,
  US: 1995,
};

const FREE_DOMESTIC_FROM = 5000;

export function lineTotal(line: OrderLine): number {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new RangeError(`quantity must be a positive integer, got ${line.quantity}`);
  }
  if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
    throw new RangeError(`unit price must be a whole number of pence, got ${line.unitPrice}`);
  }
  return line.quantity * line.unitPrice;
}

export function shippingFor(country: string, subtotal: number): number {
  const rate = SHIPPING[country];
  if (rate === undefined) throw new RangeError(`no shipping rate for ${country}`);
  if (country === 'GB' && subtotal >= FREE_DOMESTIC_FROM) return 0;
  return rate;
}

export function priceOrder(lines: OrderLine[], country: string): Price {
  if (lines.length === 0) throw new RangeError('an order needs at least one line');
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const shipping = shippingFor(country, subtotal);
  return { subtotal, shipping, total: subtotal + shipping };
}

export function formatMoney(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}
