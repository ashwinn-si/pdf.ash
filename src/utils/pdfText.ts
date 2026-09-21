/**
 * WinAnsi-safe text for pdf-lib's standard 14 fonts.
 *
 * pdf-lib's base-14 fonts (Helvetica, Times, Courier — the only fonts this
 * app embeds, in `markdownToPdf.ts` and for text annotations) can only
 * encode WinAnsi (Windows-1252): drawing `₹`, `→`, an emoji, or anything else
 * outside that repertoire throws `WinAnsi cannot encode "…"` and aborts the
 * whole download (#2). `toWinAnsi` maps every character in a string into
 * something WinAnsi can draw, so building the PDF never throws — at worst a
 * character becomes '?'.
 */

// The 27 characters CP1252 defines in the 0x80–0x9F range that plain
// Latin-1/ISO-8859-1 leaves as C1 control codes. Order matches the codepage:
// 0x80, 0x82–0x8C, 0x8E, 0x91–0x9C, 0x9E, 0x9F (0x81/0x8D/0x8F/0x90/0x9D are
// undefined in CP1252 and excluded).
const CP1252_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const CP1252_EXTRA_CODEPOINTS = new Set<number>(
  [...CP1252_EXTRAS].map((ch) => ch.codePointAt(0)!)
);

// Zero-width characters and the BOM: invisible, and drawing them wastes a
// glyph-width lookup for nothing a reader could ever see.
const ZERO_WIDTH_CODEPOINTS = new Set<number>([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

// Unicode "Space_Separator" category — covers the non-breaking space (which,
// confusingly, *is* directly WinAnsi-encodable at 0xA0, but renders as a
// visually blank cell in most fonts) plus the various fixed-width spaces
// that show up when text is copied from word processors or typeset PDFs.
const SPACE_SEPARATOR_RE = /\p{Zs}/u;

/** Common symbols with an obvious plain-text equivalent, keyed by code point. */
const TRANSLITERATIONS: Record<number, string> = {
  0x20b9: 'Rs.', // ₹
  0x2192: '->', // →
  0x2190: '<-', // ←
  0x2265: '>=', // ≥
  0x2264: '<=', // ≤
  0x2260: '!=', // ≠
  0x2713: 'v', // ✓
  0x2714: 'v', // ✔
  0x2717: 'x', // ✗
  0x2718: 'x', // ✘
  0x2033: '"', // ″ double prime
  0x2032: "'", // ′ prime
};

function isDirectlyEncodable(codePoint: number): boolean {
  if (codePoint === 0x0a) return true; // '\n' — a structural line break, not drawn
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true; // ASCII printable
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true; // Latin-1 supplement (incl. × at 0xD7)
  return CP1252_EXTRA_CODEPOINTS.has(codePoint);
}

/**
 * Rewrite `text` so every character is drawable with a WinAnsi-encoded
 * standard font. Iterates by Unicode code point (via `for...of`, not string
 * indexing) so a surrogate-pair emoji collapses to a single '?' instead of
 * two mangled halves.
 *
 * `replaced` lists the distinct *original* characters that visibly changed —
 * a transliteration or a '?' fallback — for a UI hint like "₹ and emoji will
 * be replaced". Invisible fixups (zero-width stripping, space
 * normalisation, tab expansion) aren't included: the reader would never
 * notice those either way.
 */
export function toWinAnsi(text: string): { text: string; replaced: string[] } {
  const normalized = text.normalize('NFC');
  let out = '';
  const replaced = new Set<string>();

  for (const ch of normalized) {
    const codePoint = ch.codePointAt(0)!;

    if (ZERO_WIDTH_CODEPOINTS.has(codePoint)) continue;
    if (codePoint === 0x09) {
      out += '    ';
      continue;
    }
    if (SPACE_SEPARATOR_RE.test(ch)) {
      out += ' ';
      continue;
    }

    const transliteration = TRANSLITERATIONS[codePoint];
    if (transliteration !== undefined) {
      out += transliteration;
      replaced.add(ch);
      continue;
    }

    if (isDirectlyEncodable(codePoint)) {
      out += ch;
      continue;
    }

    out += '?';
    replaced.add(ch);
  }

  return { text: out, replaced: [...replaced] };
}

/** The distinct characters in `text` that `toWinAnsi` would visibly change —
 * used to warn in the editor before a WinAnsi issue would otherwise only
 * surface as a failed download. */
export function unsupportedChars(text: string): string[] {
  return toWinAnsi(text).replaced;
}
