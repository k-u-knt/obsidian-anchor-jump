/**
 * Pure Markdown helpers (titles, headings, block segmentation).
 * No Obsidian imports, so it can be unit-tested in Node.
 *
 * Since v0.4 links are text quotes (src/quote.ts) and nothing is written into
 * notes; planAnchor below is kept only as a tested utility and for reference.
 *
 * Obsidian block-ID rules (help.obsidian.md/links):
 *  - paragraphs / list items: " ^id" at the end of the line
 *  - structured blocks (quotes, callouts, tables, code): "^id" on its own line,
 *    with a blank line before and after
 *  - IDs: Latin letters, digits, dashes
 */

export type BlockType =
	| 'paragraph' | 'heading' | 'listItem'
	| 'code' | 'math' | 'table' | 'quote'
	| 'frontmatter' | 'hr';

export interface Block {
	type: BlockType;
	start: number;      // first line (0-based)
	end: number;        // last line (inclusive)
	id?: string;        // existing block id
	headingText?: string;
}

export type Ref =
	| { kind: 'block'; id: string }
	| { kind: 'heading'; text: string }
	| { kind: 'quote'; q: string; qe?: string; line: number }   // text anchor, nothing written to the note
	| { kind: 'file' };

export interface Pos { line: number; ch: number }
export interface Edit { at: Pos; text: string }

export interface AnchorPlan {
	edits: Edit[];          // sorted bottom-up; apply in order
	start: Ref;
	end?: Ref;              // set when the selection spans several blocks
	startBlock?: Block;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST = /^\s*([-*+]|\d+[.)])(\s+|$)/;
const QUOTE = /^\s*>/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const MATH = /^\s*\$\$/;
export const ID_TAIL = /\s\^([A-Za-z0-9-]+)\s*$/;
export const ID_LINE = /^\s*\^([A-Za-z0-9-]+)\s*$/;

const STRUCTURED: BlockType[] = ['code', 'math', 'table', 'quote'];
const isBlank = (s: string | undefined) => s === undefined || s.trim() === '';

function isHr(l: string) { return HR.test(l); }
function isList(l: string) { return !isHr(l) && LIST.test(l); }
function isTableStart(lines: string[], i: number) {
	const next = lines[i + 1];
	return lines[i].includes('|') && next !== undefined && next.includes('-') && TABLE_SEP.test(next);
}
function startsBlock(lines: string[], i: number): boolean {
	const l = lines[i];
	return HEADING.test(l) || FENCE.test(l) || MATH.test(l) || QUOTE.test(l) || isHr(l) || isList(l);
}

/** Obsidian heading text as used in [[Note#Heading]] links. */
export function headingLinkText(raw: string): string {
	return raw
		.replace(/\s+#+\s*$/, '')       // closing #'s
		.replace(/[#|^:[\]\\]+/g, ' ')  // chars Obsidian disallows in heading links
		.replace(/\s+/g, ' ')
		.trim();
}

export function segment(lines: string[]): Block[] {
	const blocks: Block[] = [];
	const n = lines.length;
	let i = 0;

	if (lines[0]?.trim() === '---') {
		let j = 1;
		while (j < n && !/^(---|\.\.\.)\s*$/.test(lines[j])) j++;
		if (j < n) { blocks.push({ type: 'frontmatter', start: 0, end: j }); i = j + 1; }
	}

	while (i < n) {
		const l = lines[i];
		if (isBlank(l)) { i++; continue; }

		// Stand-alone "^id" line → belongs to the previous structured block
		const idm = ID_LINE.exec(l);
		if (idm) {
			const prev = blocks[blocks.length - 1];
			if (prev && STRUCTURED.includes(prev.type) && !prev.id) prev.id = idm[1];
			i++; continue;
		}

		const fm = FENCE.exec(l);
		if (fm) {
			const ch = fm[1][0], len = fm[1].length;
			const close = new RegExp(`^\\s*\\${ch}{${len},}\\s*$`);
			let j = i + 1;
			while (j < n && !close.test(lines[j])) j++;
			const end = Math.min(j, n - 1);
			blocks.push({ type: 'code', start: i, end });
			i = end + 1; continue;
		}

		if (MATH.test(l)) {
			const rest = l.trim().slice(2);
			let end = i;
			if (!rest.includes('$$')) {
				let j = i + 1;
				while (j < n && !/\$\$/.test(lines[j])) j++;
				end = Math.min(j, n - 1);
			}
			blocks.push({ type: 'math', start: i, end });
			i = end + 1; continue;
		}

		const hm = HEADING.exec(l);
		if (hm) {
			blocks.push({ type: 'heading', start: i, end: i, headingText: hm[2] });
			i++; continue;
		}

		if (isHr(l)) { blocks.push({ type: 'hr', start: i, end: i }); i++; continue; }

		if (QUOTE.test(l)) {
			let j = i;
			while (j + 1 < n && QUOTE.test(lines[j + 1])) j++;
			blocks.push({ type: 'quote', start: i, end: j });
			i = j + 1; continue;
		}

		if (isTableStart(lines, i)) {
			let j = i + 1;
			while (j + 1 < n && !isBlank(lines[j + 1]) && lines[j + 1].includes('|')) j++;
			blocks.push({ type: 'table', start: i, end: j });
			i = j + 1; continue;
		}

		if (isList(l)) {
			let j = i;
			while (j < n && isList(lines[j])) {
				// one item = its bullet line + continuation lines (not new bullets)
				let k = j + 1;
				while (k < n && !isBlank(lines[k]) && !isList(lines[k]) &&
					(/^\s/.test(lines[k]) || !startsBlock(lines, k))) {
					// indented fenced code inside an item
					const f = FENCE.exec(lines[k]);
					if (f) {
						const close = new RegExp(`^\\s*\\${f[1][0]}{${f[1].length},}\\s*$`);
						k++;
						while (k < n && !close.test(lines[k])) k++;
					}
					k++;
				}
				blocks.push({ type: 'listItem', start: j, end: Math.min(k, n) - 1 });
				j = k;
				// a loose list continues across blank lines if the next line is a bullet
				let m = j;
				while (m < n && isBlank(lines[m])) m++;
				if (m > j && m < n && isList(lines[m])) j = m;
			}
			i = j; continue;
		}

		// paragraph
		let j = i;
		while (j + 1 < n && !isBlank(lines[j + 1]) && !startsBlock(lines, j + 1)) j++;
		blocks.push({ type: 'paragraph', start: i, end: j });
		i = j + 1;
	}

	// existing trailing ids for inline-id blocks
	for (const b of blocks) {
		if (b.type === 'paragraph' || b.type === 'listItem') {
			const m = ID_TAIL.exec(lines[b.end]) ?? (b.type === 'listItem' ? ID_TAIL.exec(lines[b.start]) : null);
			if (m) b.id = m[1];
		}
	}
	return blocks;
}

const ANCHORABLE = (b: Block) => b.type !== 'frontmatter' && b.type !== 'hr';

/** Block containing `line`; otherwise nearest anchorable block (prefer after, or before). */
export function blockAt(blocks: Block[], line: number, prefer: 'after' | 'before'): Block | undefined {
	const inside = blocks.find(b => b.start <= line && line <= b.end);
	if (inside && ANCHORABLE(inside)) return inside;
	const after = blocks.find(b => b.start > line && ANCHORABLE(b));
	const before = [...blocks].reverse().find(b => b.end < line && ANCHORABLE(b));
	return prefer === 'after' ? (after ?? before) : (before ?? after);
}

export function randomId(): string {
	return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

interface RefResult { ref: Ref; edits: Edit[] }

function refFor(lines: string[], b: Block, newId: () => string): RefResult {
	const edits: Edit[] = [];
	if (b.type === 'heading') {
		return { ref: { kind: 'heading', text: headingLinkText(b.headingText ?? '') }, edits };
	}

	if (b.type === 'paragraph' || b.type === 'listItem') {
		if (b.id) return { ref: { kind: 'block', id: b.id }, edits };
		const id = newId();
		const lastLine = lines[b.end];
		edits.push({ at: { line: b.end, ch: lastLine.trimEnd().length }, text: ' ^' + id });
		return { ref: { kind: 'block', id }, edits };
	}

	// structured blocks: id on its own line, blank line before and after
	if (b.id) return { ref: { kind: 'block', id: b.id }, edits };
	const id = newId();
	const next = lines[b.end + 1];
	const text = '\n\n^' + id + (next !== undefined && !isBlank(next) ? '\n' : '');
	edits.push({ at: { line: b.end, ch: lines[b.end].length }, text });
	return { ref: { kind: 'block', id }, edits };
}

/**
 * Plan the edits needed to make [fromLine, toLine] linkable.
 * The start block always gets a ref; the end block gets a ref only if it is a
 * different block. Nothing but block ids is ever written into the note.
 */
export function planAnchor(
	lines: string[], fromLine: number, toLine: number,
	opts: { newId?: () => string } = {},
): AnchorPlan {
	const newId = opts.newId ?? randomId;
	const blocks = segment(lines);
	const sb = blockAt(blocks, fromLine, 'after');
	if (!sb) return { edits: [], start: { kind: 'file' } };
	const eb = blockAt(blocks, Math.max(toLine, fromLine), 'before');

	const s = refFor(lines, sb, newId);
	let edits = [...s.edits];
	let end: Ref | undefined;
	if (eb && eb !== sb && eb.start > sb.start) {
		const e = refFor(lines, eb, newId);
		end = e.ref;
		edits = edits.concat(e.edits);
	}
	edits.sort((a, b) => b.at.line - a.at.line || b.at.ch - a.at.ch);
	return { edits, start: s.ref, end, startBlock: sb };
}

/** Apply edits to a plain string (used by tests and by background-file edits). */
export function applyEdits(lines: string[], edits: Edit[]): string[] {
	const out = [...lines];
	for (const e of edits) {
		const l = out[e.at.line];
		const merged = l.slice(0, e.at.ch) + e.text + l.slice(e.at.ch);
		out.splice(e.at.line, 1, ...merged.split('\n'));
	}
	return out;
}

/** Nearest heading at or above `line` (for human-readable context). */
export function headingAbove(lines: string[], line: number): string | undefined {
	for (let i = line; i >= 0; i--) {
		const m = HEADING.exec(lines[i] ?? '');
		if (m) return headingLinkText(m[2]);
	}
	return undefined;
}

/** Turn a raw Markdown selection into a clean one-line title. */
export function cleanTitle(sel: string, max = 100): string {
	const clean = (l: string) => l
		.replace(ID_TAIL, '')
		.replace(/^\s*>\s?(\[![^\]]*\][+-]?\s*)?/, '')
		.replace(/^\s*#{1,6}\s+/, '')
		.replace(/^\s*([-*+]|\d+[.)])\s+(\[.\]\s+)?/, '')
		.replace(/!\[\[([^\]|]+?)(\|[^\]]*)?\]\]/g, (_m, p) => String(p).split('/').pop() ?? p)
		.replace(/\[\[([^\]|]+?)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__|==|~~|`)/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const raw = sel.split('\n').filter(l => l.trim());
	const isHeading = (l: string) => /^\s*#{1,6}\s/.test(l);
	// A selection that starts at the note's H1 is about the note itself: use it.
	// Otherwise prefer the first non-heading line (section headings like
	// "2026-09-28" or "🔗Links" make poor titles).
	const pick = (raw[0] && /^\s*#\s/.test(raw[0]) && clean(raw[0]) ? raw[0] : undefined)
		?? raw.find(l => !isHeading(l) && clean(l)) ?? raw[0] ?? '';
	const t = clean(pick);
	return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/**
 * Reading view: a list is rendered as one section, and each <li> carries a
 * data-line offset. Resolve it to a source line, accepting either a
 * section-relative or an absolute offset (whichever lands on a list line).
 */
export function listItemLine(lines: string[], sectionStart: number, sectionEnd: number, dataLine: number): number {
	const ok = (l: number) => l >= sectionStart && l <= sectionEnd && LIST.test(lines[l] ?? '');
	if (ok(sectionStart + dataLine)) return sectionStart + dataLine;
	if (ok(dataLine)) return dataLine;
	return sectionStart;
}
