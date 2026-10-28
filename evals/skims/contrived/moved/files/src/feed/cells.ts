export function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function normaliseSku(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function quantityOf(raw: string): number {
  const parsed = Number(raw.trim());
  if (Number.isNaN(parsed)) throw new Error(`bad quantity: ${raw}`);
  return Math.max(0, parsed);
}
