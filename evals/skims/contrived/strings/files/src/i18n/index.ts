import de from './de.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };
import fr from './fr.json' with { type: 'json' };

const tables: Record<string, Record<string, string>> = { en, de, fr };

export function t(locale: string, key: string, vars: Record<string, string | number> = {}): string {
  const table = tables[locale] ?? tables.en!;
  const text = table[key] ?? en[key as keyof typeof en] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

/** A count in the locale's own digits and grouping: 12 345 in French, 12.345 in German. */
export function formatCount(locale: string, count: number): string {
  const tag = locale in tables ? locale : 'en';
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(count);
}
