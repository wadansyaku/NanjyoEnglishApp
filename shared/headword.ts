export type NormalizeHeadwordOptions = {
  stripPossessive?: boolean;
};

const APOSTROPHE_CHARS = /[’‘`´]/g;
const NON_ASCII_LETTERS = /[^a-z'\s-]/g;
const POSSESSIVE_SUFFIX = /'s$/;

export const normalizeHeadword = (
  value: string,
  options: NormalizeHeadwordOptions = {}
) => {
  const stripPossessive = options.stripPossessive ?? true;
  const lowered = value.trim().toLowerCase().replace(APOSTROPHE_CHARS, "'");
  if (!lowered) return '';

  // Keep only letters/apostrophes/spaces/hyphens, then split on spaces and hyphens.
  const cleaned = lowered.replace(NON_ASCII_LETTERS, ' ').replace(/\s+/g, ' ');
  const rawTokens = cleaned
    .split(/[\s-]+/)
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter(Boolean);

  const tokens = rawTokens
    .map((token) => {
      if (!stripPossessive) return token;
      if (token.length <= 2) return token;
      return token.replace(POSSESSIVE_SUFFIX, '');
    })
    .filter((token) => token.length > 0);

  // Join tokens to keep a single canonical key (space/hyphen insensitive).
  return tokens.join('');
};

