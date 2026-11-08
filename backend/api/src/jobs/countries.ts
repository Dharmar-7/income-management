// The country catalogue the Jobs aggregator can search. Far wider than Adzuna's
// 19 markets: Careerjet (~90 countries) and Jooble (global) reach the rest, so a
// country here with no Adzuna coverage still returns results from those.
//
// Each entry carries the full `name` (used as the `location` query for Jooble &
// The Muse, which take a place name) and Careerjet's `language_COUNTRY` locale.
// This file is the single source of truth — COUNTRY_NAME and CAREERJET_LOCALE
// below are derived from it.

export interface CountryMeta { name: string; locale: string }

export const COUNTRIES: Record<string, CountryMeta> = {
  // Asia-Pacific
  in: { name: 'India', locale: 'en_IN' },
  sg: { name: 'Singapore', locale: 'en_SG' },
  my: { name: 'Malaysia', locale: 'en_MY' },
  ph: { name: 'Philippines', locale: 'en_PH' },
  hk: { name: 'Hong Kong', locale: 'en_HK' },
  jp: { name: 'Japan', locale: 'ja_JP' },
  kr: { name: 'South Korea', locale: 'ko_KR' },
  cn: { name: 'China', locale: 'zh_CN' },
  tw: { name: 'Taiwan', locale: 'zh_TW' },
  id: { name: 'Indonesia', locale: 'id_ID' },
  th: { name: 'Thailand', locale: 'th_TH' },
  vn: { name: 'Vietnam', locale: 'vi_VN' },
  pk: { name: 'Pakistan', locale: 'en_PK' },
  bd: { name: 'Bangladesh', locale: 'en_BD' },
  lk: { name: 'Sri Lanka', locale: 'en_LK' },
  np: { name: 'Nepal', locale: 'en_NP' },
  au: { name: 'Australia', locale: 'en_AU' },
  nz: { name: 'New Zealand', locale: 'en_NZ' },
  // Middle East
  ae: { name: 'United Arab Emirates', locale: 'en_AE' },
  sa: { name: 'Saudi Arabia', locale: 'en_SA' },
  qa: { name: 'Qatar', locale: 'en_QA' },
  kw: { name: 'Kuwait', locale: 'en_KW' },
  bh: { name: 'Bahrain', locale: 'en_BH' },
  om: { name: 'Oman', locale: 'en_OM' },
  il: { name: 'Israel', locale: 'en_IL' },
  tr: { name: 'Turkey', locale: 'tr_TR' },
  // Europe
  gb: { name: 'United Kingdom', locale: 'en_GB' },
  ie: { name: 'Ireland', locale: 'en_IE' },
  de: { name: 'Germany', locale: 'de_DE' },
  fr: { name: 'France', locale: 'fr_FR' },
  nl: { name: 'Netherlands', locale: 'nl_NL' },
  be: { name: 'Belgium', locale: 'fr_BE' },
  lu: { name: 'Luxembourg', locale: 'fr_LU' },
  ch: { name: 'Switzerland', locale: 'de_CH' },
  at: { name: 'Austria', locale: 'de_AT' },
  it: { name: 'Italy', locale: 'it_IT' },
  es: { name: 'Spain', locale: 'es_ES' },
  pt: { name: 'Portugal', locale: 'pt_PT' },
  se: { name: 'Sweden', locale: 'sv_SE' },
  no: { name: 'Norway', locale: 'no_NO' },
  dk: { name: 'Denmark', locale: 'da_DK' },
  fi: { name: 'Finland', locale: 'fi_FI' },
  pl: { name: 'Poland', locale: 'pl_PL' },
  cz: { name: 'Czechia', locale: 'cs_CZ' },
  sk: { name: 'Slovakia', locale: 'sk_SK' },
  hu: { name: 'Hungary', locale: 'hu_HU' },
  ro: { name: 'Romania', locale: 'ro_RO' },
  bg: { name: 'Bulgaria', locale: 'bg_BG' },
  gr: { name: 'Greece', locale: 'el_GR' },
  hr: { name: 'Croatia', locale: 'hr_HR' },
  si: { name: 'Slovenia', locale: 'sl_SI' },
  rs: { name: 'Serbia', locale: 'sr_RS' },
  ua: { name: 'Ukraine', locale: 'uk_UA' },
  ru: { name: 'Russia', locale: 'ru_RU' },
  ee: { name: 'Estonia', locale: 'et_EE' },
  lv: { name: 'Latvia', locale: 'lv_LV' },
  lt: { name: 'Lithuania', locale: 'lt_LT' },
  kz: { name: 'Kazakhstan', locale: 'ru_KZ' },
  // Americas
  us: { name: 'United States', locale: 'en_US' },
  ca: { name: 'Canada', locale: 'en_CA' },
  br: { name: 'Brazil', locale: 'pt_BR' },
  mx: { name: 'Mexico', locale: 'es_MX' },
  ar: { name: 'Argentina', locale: 'es_AR' },
  cl: { name: 'Chile', locale: 'es_CL' },
  co: { name: 'Colombia', locale: 'es_CO' },
  pe: { name: 'Peru', locale: 'es_PE' },
  ve: { name: 'Venezuela', locale: 'es_VE' },
  cr: { name: 'Costa Rica', locale: 'es_CR' },
  uy: { name: 'Uruguay', locale: 'es_UY' },
  ec: { name: 'Ecuador', locale: 'es_EC' },
  do: { name: 'Dominican Republic', locale: 'es_DO' },
  // Africa
  za: { name: 'South Africa', locale: 'en_ZA' },
  ng: { name: 'Nigeria', locale: 'en_NG' },
  ke: { name: 'Kenya', locale: 'en_KE' },
  gh: { name: 'Ghana', locale: 'en_GH' },
  tz: { name: 'Tanzania', locale: 'en_TZ' },
  ug: { name: 'Uganda', locale: 'en_UG' },
  eg: { name: 'Egypt', locale: 'en_EG' },
  ma: { name: 'Morocco', locale: 'fr_MA' },
  dz: { name: 'Algeria', locale: 'fr_DZ' },
  tn: { name: 'Tunisia', locale: 'fr_TN' },
};

export const COUNTRY_NAME: Record<string, string> =
  Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, v.name]));

export const CAREERJET_LOCALE: Record<string, string> =
  Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, v.locale]));
