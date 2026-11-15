// The word filter on names and card texts (plan-forge phases 4 and 8):
// every authored string on a forged champion passes through here before
// it is stored. Deliberately narrow: it blocks slurs and hard profanity
// after normalization (case, separators, digit-for-letter swaps), and
// nothing else; creative names are the point of the Forge and a filter
// that overreaches kills more good names than bad ones. Moderation depth
// beyond this (reports, takedowns) is the gallery's job (phase 7).

// Substring terms: blocked wherever they appear, since padding a slur
// with letters is the oldest trick. Keep this list to terms with no
// innocent containing word, short of the few named in INNOCENT_HOSTS; a
// term that lives inside many ordinary words (spic in spicy, despicable,
// auspicious) belongs with the word terms instead.
const SUBSTRING_TERMS: readonly string[] = [
  'nigger',
  'nigga',
  'faggot',
  'wetback',
  'chink',
  'tranny',
  'raghead',
  'porchmonkey',
];

// The ordinary words that hold a substring term, read past before the
// substring scan, so they pass while the term padded any other way does
// not.
const INNOCENT_HOSTS: readonly string[] = ['snigger', 'chinkapin', 'chinking', 'chinked'];

// Whole-word terms: blocked only as words, because they live inside
// innocent ones (Scunthorpe holds classes about this).
const WORD_TERMS: readonly string[] = [
  'spic',
  'spics',
  'kike',
  'kikes',
  'fuck',
  'fucker',
  'motherfucker',
  'shit',
  'bitch',
  'cunt',
  'whore',
  'slut',
  'rape',
  'rapist',
  'nazi',
  'hitler',
  'retard',
  'fag',
  'dyke',
  'coon',
  'penis',
  'vagina',
  'dick',
  'cock',
  'anal',
  'cum',
];

// Digit and symbol stand-ins the normalization folds back into letters.
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};

// Lowercase, fold leet, keep letters only. "F.u_c-k" and "FUCK" squeeze
// to the same string.
function squeeze(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) {
    const folded = LEET[ch] ?? ch;
    if (/[a-z]/.test(folded)) out += folded;
  }
  return out;
}

// The first blocked term found across the given texts, null when clean.
// Returning the term (not just a boolean) lets the refusal say why.
// Substring terms scan the whole squeezed text; word terms must equal a
// whole whitespace-delimited token after squeezing, so a word hiding
// inside an innocent one (the Scunthorpe rule) never trips it.
export function findBlockedWord(texts: readonly string[]): string | null {
  for (const text of texts) {
    let squeezedAll = squeeze(text);
    // A separator in the host's place, so the letters around it never join.
    for (const host of INNOCENT_HOSTS) squeezedAll = squeezedAll.split(host).join('|');
    for (const term of SUBSTRING_TERMS) {
      if (squeezedAll.includes(term)) return term;
    }
    const tokens = new Set(text.split(/\s+/).map(squeeze));
    for (const term of WORD_TERMS) {
      if (tokens.has(term)) return term;
    }
  }
  return null;
}
