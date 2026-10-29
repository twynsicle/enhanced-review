import de from './de.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };

const tables: Record<string, Record<string, string>> = { en, de };

export function t(locale: string, key: string, vars: Record<string, string | number> = {}): string {
  const table = tables[locale] ?? tables.en!;
  const text = table[key] ?? en[key as keyof typeof en] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
