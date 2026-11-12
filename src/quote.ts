/**
 * Text-quote anchors: a link remembers the selected text (plus the line it was
 * on) instead of writing a block ID into the note. Pure, unit-tested.
 */

export interface Quote {
	q: string;      // the selected text, or its first part when long
	qe?: string;    // last part of a long selection
	line: number;   // 0-based line the selection started on (tie-breaker / fallback)
}

const HEAD = 300;

export function makeQuote(text: string, line: number): Quote | null {
	const s = text.trim();
	if (!s) return null;
	if (s.length <= HEAD * 2) return { q: s, line };
	return { q: s.slice(0, HEAD), qe: s.slice(-HEAD), line };
}

/**
 * The offset (from an ascending list) whose line is closest to `hint`; the
 * earlier one wins a tie. One pass over the text, however many offsets there
 * are, so a very common quote cannot stall the UI.
 */
function nearestToLine(text: string, offsets: number[], hint: number): number {
	let best = offsets[0], bestDist = Infinity, line = 0, pos = 0;
	for (const off of offsets) {
		for (; pos < off && pos < text.length; pos++) if (text.charCodeAt(pos) === 10) line++;
		const d = Math.abs(line - hint);
		if (d < bestDist) { best = off; bestDist = d; }
		if (line > hint) break;   // later matches only get further away
	}
	return best;
}

function allIndexes(text: string, needle: string): number[] {
	const out: number[] = [];
	if (!needle) return out;
	for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i);
	return out;
}

/**
 * Find the quoted text in the note. Exact match first (nearest to the original
 * line when it occurs several times); then the start of the quote; else null.
 * Returns character offsets [from, to).
 */
export function findQuote(text: string, quote: { q: string; qe?: string; line?: number }): { from: number; to: number; exact: boolean } | null {
	const hint = quote.line ?? 0;
	const nearest = (xs: number[]) => nearestToLine(text, xs, hint);

	const starts = allIndexes(text, quote.q);
	if (starts.length) {
		const from = nearest(starts);
		if (!quote.qe) return { from, to: from + quote.q.length, exact: true };
		const e = text.indexOf(quote.qe, from + quote.q.length);   // tail starts after the head (selection > 600 chars)
		if (e >= 0) return { from, to: e + quote.qe.length, exact: true };
		return { from, to: from + quote.q.length, exact: false };
	}
	// text was edited: try the first words of the quote
	const firstLine = quote.q.split('\n')[0].trim();
	for (const n of [48, 32, 20, 12]) {
		const head = firstLine.slice(0, n).trim();
		if (head.length < 8) break;
		const xs = allIndexes(text, head);
		if (xs.length) {
			const from = nearest(xs);
			const eol = text.indexOf('\n', from);
			return { from, to: eol < 0 ? text.length : eol, exact: false };
		}
	}
	return null;
}
