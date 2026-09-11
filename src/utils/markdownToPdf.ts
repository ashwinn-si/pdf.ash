import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Renders a Markdown (.md) file into a paginated PDF, entirely client-side.
 * Supports the common subset of Markdown: headings, paragraphs, bold/italic/
 * inline code, fenced code blocks, block quotes, ordered/unordered lists
 * (with basic nesting), horizontal rules, and links (rendered as their text).
 *
 * This is a deliberately compact hand-rolled parser + layout engine rather
 * than a full CommonMark implementation — pdf-lib has no rich-text/HTML
 * renderer, so every token still has to be measured and placed by hand
 * regardless of which parser produced it.
 */

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TEXT_COLOR = rgb(0.094, 0.094, 0.106);
const MUTED_COLOR = rgb(0.32, 0.32, 0.37);
const RULE_COLOR = rgb(0.85, 0.85, 0.87);
const CODE_BG = rgb(0.96, 0.96, 0.97);
const CODE_TEXT = rgb(0.18, 0.18, 0.22);

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

type Block =
  | { type: 'heading'; level: number; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'listitem'; ordered: boolean; marker: string; indent: number; runs: Run[] }
  | { type: 'code'; lines: string[] }
  | { type: 'quote'; runs: Run[] }
  | { type: 'hr' };

/** Splits one line of text into styled runs for `**bold**`, `*italic*`,
 * `` `code` ``, and `[text](url)` (rendered as plain text). */
function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const pattern = /(`[^`]+`)|(\*\*\*[^*]+\*\*\*)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index) });
    }
    const m = match[0];
    if (m.startsWith('`')) {
      runs.push({ text: m.slice(1, -1), code: true });
    } else if (m.startsWith('***')) {
      runs.push({ text: m.slice(3, -3), bold: true, italic: true });
    } else if (m.startsWith('**')) {
      runs.push({ text: m.slice(2, -2), bold: true });
    } else if (m.startsWith('__')) {
      runs.push({ text: m.slice(2, -2), bold: true });
    } else if (m.startsWith('*')) {
      runs.push({ text: m.slice(1, -1), italic: true });
    } else if (m.startsWith('_')) {
      runs.push({ text: m.slice(1, -1), italic: true });
    } else if (m.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m);
      runs.push({ text: linkMatch ? linkMatch[1] : m });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex) });
  }
  return runs.filter((r) => r.text.length > 0);
}

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  const orderedCounters: number[] = [];
  let paragraphBuffer: string[] = [];
  let i = 0;

  const flushParagraph = () => {
    if (paragraphBuffer.length) {
      blocks.push({ type: 'paragraph', runs: parseInline(paragraphBuffer.join(' ')) });
      paragraphBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block
    if (/^```/.test(trimmed)) {
      flushParagraph();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code', lines: codeLines });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // ATX heading
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      blocks.push({ type: 'heading', level: headingMatch[1].length, runs: parseInline(headingMatch[2].trim()) });
      i++;
      continue;
    }

    // Block quote (consecutive `>` lines collapse into one block)
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', runs: parseInline(quoteLines.join(' ')) });
      continue;
    }

    // List item (unordered: -, *, +; ordered: 1. / 1))
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      const indent = Math.min(3, Math.floor(listMatch[1].length / 2));
      const ordered = /\d/.test(listMatch[2]);
      let marker: string;
      if (ordered) {
        orderedCounters[indent] = (orderedCounters[indent] || 0) + 1;
        marker = `${orderedCounters[indent]}.`;
      } else {
        marker = '•';
        orderedCounters[indent] = 0;
      }
      blocks.push({ type: 'listitem', ordered, marker, indent, runs: parseInline(listMatch[3]) });
      i++;
      continue;
    }

    // Blank line ends the current paragraph/list run
    if (trimmed === '') {
      flushParagraph();
      orderedCounters.length = 0;
      i++;
      continue;
    }

    // Anything else accumulates into the current paragraph
    paragraphBuffer.push(trimmed);
    i++;
  }
  flushParagraph();
  return blocks;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
}

function pickFont(run: Run, fonts: Fonts): PDFFont {
  if (run.code) return fonts.mono;
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.regular;
}

/**
 * Converts a Markdown file into a rendered, paginated PDF ArrayBuffer,
 * following the same "convert on upload" pattern as imageToPdfBuffer.
 */
export async function markdownToPdfBuffer(mdFile: File): Promise<ArrayBuffer> {
  const source = await mdFile.text();
  const blocks = parseMarkdown(source);

  const pdfDoc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdfDoc.embedFont(StandardFonts.Courier),
  };

  let page: PDFPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const ensureSpace = (height: number) => {
    if (y - height < MARGIN) newPage();
  };

  /** Word-wraps styled runs into lines and draws them, advancing `y`. */
  const drawRuns = (
    runs: Run[],
    x: number,
    maxWidth: number,
    fontSize: number,
    lineHeight: number,
    color = TEXT_COLOR
  ) => {
    const spaceWidth = fonts.regular.widthOfTextAtSize(' ', fontSize);
    type Word = { text: string; font: PDFFont; size: number; width: number };
    const words: Word[] = [];
    for (const run of runs) {
      const font = pickFont(run, fonts);
      const size = run.code ? fontSize * 0.92 : fontSize;
      for (const w of run.text.split(/\s+/).filter(Boolean)) {
        words.push({ text: w, font, size, width: font.widthOfTextAtSize(w, size) });
      }
    }
    if (words.length === 0) return;

    const lines: Word[][] = [];
    let current: Word[] = [];
    let currentWidth = 0;
    for (const word of words) {
      const addedWidth = word.width + (current.length ? spaceWidth : 0);
      if (current.length && currentWidth + addedWidth > maxWidth) {
        lines.push(current);
        current = [word];
        currentWidth = word.width;
      } else {
        current.push(word);
        currentWidth += addedWidth;
      }
    }
    if (current.length) lines.push(current);

    for (const line of lines) {
      ensureSpace(lineHeight);
      let cx = x;
      for (const word of line) {
        page.drawText(word.text, { x: cx, y: y - fontSize, size: word.size, font: word.font, color });
        cx += word.width + spaceWidth;
      }
      y -= lineHeight;
    }
  };

  const headingSizes: Record<number, number> = { 1: 24, 2: 20, 3: 17, 4: 15, 5: 13, 6: 12 };

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const size = headingSizes[block.level] ?? 12;
        ensureSpace(size * 1.6);
        y -= 8;
        drawRuns(
          block.runs.map((r) => ({ ...r, bold: true })),
          MARGIN,
          CONTENT_WIDTH,
          size,
          size * 1.25
        );
        y -= 6;
        break;
      }

      case 'paragraph':
        drawRuns(block.runs, MARGIN, CONTENT_WIDTH, 11, 15.5);
        y -= 10;
        break;

      case 'listitem': {
        const indentX = MARGIN + block.indent * 18;
        ensureSpace(15.5);
        page.drawText(block.marker, { x: indentX, y: y - 11, size: 11, font: fonts.regular, color: MUTED_COLOR });
        drawRuns(block.runs, indentX + 16, CONTENT_WIDTH - (indentX + 16 - MARGIN), 11, 15.5);
        y -= 2;
        break;
      }

      case 'code': {
        const lineHeight = 13;
        const boxHeight = Math.max(lineHeight, block.lines.length * lineHeight) + 16;
        ensureSpace(boxHeight + 8);
        page.drawRectangle({ x: MARGIN, y: y - boxHeight, width: CONTENT_WIDTH, height: boxHeight, color: CODE_BG });
        let cy = y - 12;
        for (const raw of block.lines) {
          // Fall back gracefully if a single line is wider than the box —
          // truncate rather than overflow the background rectangle.
          let line = raw;
          const maxChars = 100;
          if (line.length > maxChars) line = line.slice(0, maxChars - 1) + '…';
          page.drawText(line, { x: MARGIN + 12, y: cy, size: 10, font: fonts.mono, color: CODE_TEXT });
          cy -= lineHeight;
        }
        y -= boxHeight + 10;
        break;
      }

      case 'quote':
        drawRuns(
          block.runs.map((r) => ({ ...r, italic: true })),
          MARGIN + 14,
          CONTENT_WIDTH - 14,
          11,
          15.5,
          MUTED_COLOR
        );
        y -= 8;
        break;

      case 'hr':
        ensureSpace(20);
        y -= 8;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: RULE_COLOR });
        y -= 14;
        break;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
}
