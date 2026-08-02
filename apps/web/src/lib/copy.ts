import messages from '../../messages/en.json';

/**
 * Every user-facing string, in one file, reachable by a typed dot path.
 *
 * This replaces next-intl. The app ships in English only, and an i18n runtime
 * for a single language is ~45KB of JavaScript on every page to solve a
 * problem we do not have — which matters on a product whose landing pages are
 * budgeted in kilobytes.
 *
 * Keeping the catalogue rather than inlining the strings is not sentiment
 * about translation: it is that copy is the thing most often edited by someone
 * who is not going to open a `.tsx` file, and having it in one place is worth
 * the twenty lines below regardless of how many languages there are.
 *
 * `t` is a pure function of a constant, so it works identically in server and
 * client components with no provider, no context and no bundle cost.
 */

type Leaves<T> = T extends string
  ? ''
  : {
      [K in keyof T & string]: Leaves<T[K]> extends '' ? K : `${K}.${Leaves<T[K]>}`;
    }[keyof T & string];

export type CopyKey = Leaves<typeof messages>;

export type CopyValues = Record<string, string | number>;

function lookup(key: string): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = (node as Record<string, unknown>)[part];
  }
  // Falling back to the key rather than throwing: a missing string should show
  // up as an obviously wrong label, not take the page down.
  return typeof node === 'string' ? node : key;
}

export function t(key: CopyKey, values?: CopyValues): string {
  const template = lookup(key);
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** For keys built at runtime — note codes, execution reasons — where the exact
 *  member is only known once the compiler has run. */
export function tDynamic(key: string, values?: CopyValues): string {
  const template = lookup(key);
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
