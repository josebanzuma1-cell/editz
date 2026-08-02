import { defineRouting } from 'next-intl/routing';

/**
 * English and Swahili ship now (§11). Adding Luganda is meant to be trivial:
 * add `'lg'` here, add `messages/lg.json`, and every page, tool name and
 * control label follows. Nothing else in the app knows how many locales exist.
 *
 * `as-needed` keeps English on the bare path — `/compress-video` rather than
 * `/en/compress-video` — because the English URLs are the ones that have to
 * rank, and a redirect on every one of them is a needless tax on a slow
 * connection.
 */
export const routing = defineRouting({
  locales: ['en', 'sw'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
