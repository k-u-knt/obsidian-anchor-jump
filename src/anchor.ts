import { App, Editor, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { cleanTitle, headingAbove, headingLinkText, Ref, ID_TAIL } from './blocks';
import { makeQuote, findQuote } from './quote';
import type { Anchor, SelectionContext } from './types';

export const JUMP_ACTION = 'anchor-jump';

const enc = encodeURIComponent;

function refParam(r?: Ref): string | undefined {
	if (!r || r.kind === 'file' || r.kind === 'quote') return undefined;
	return r.kind === 'block' ? '^' + r.id : r.text;
}

/* ------------------------------------------------------------------ */
/* Links: short by default                                             */
/* ------------------------------------------------------------------ */

/** What a registry entry (used for heading / whole-file anchors) stores. */
export interface LinkTarget {
	file: string; ref?: string; end?: string; nodes?: string;
	q?: string; qe?: string; line?: number;   // text-quote anchor (v0.4+)
}

export interface LinkConfig {
	style: 'short' | 'full';
	/** store a target, return a short key (plugin persists it in data.json) */
	register: (t: LinkTarget) => string;
	lookup: (key: string) => LinkTarget | undefined;
}

let linkConfig: LinkConfig = { style: 'full', register: () => '', lookup: () => undefined };
export function configureLinks(c: LinkConfig) { linkConfig = c; }

/** Vault id (16 hex chars) is much shorter than an emoji vault name once URL-encoded. */
function vaultParam(app: App): string {
	return (app as any).appId || app.vault.getName();
}

/**
 * Short form (~50 chars):
 *   block(s):  obsidian://anchor-jump?vault=<id>&k=<blockId>[&e=<blockId>]
 *   canvas:    obsidian://anchor-jump?vault=<id>&n=<nodeId,...>
 *   other:     obsidian://anchor-jump?vault=<id>&h=<registryKey>
 * Block and node ids are unique in the vault, so the file is found by id —
 * links keep working even after the note is renamed or moved.
 */
export function buildUri(app: App, file: TFile, start?: Ref, end?: Ref, nodes?: string[]): string {
	if (linkConfig.style === 'short') {
		const base = `obsidian://${JUMP_ACTION}?vault=${enc(vaultParam(app))}`;
		if (nodes?.length) return `${base}&n=${enc(nodes.join(','))}`;
		if (start?.kind === 'block' && (!end || end.kind === 'block')) {
			return `${base}&k=${enc(start.id)}` + (end?.kind === 'block' ? `&e=${enc(end.id)}` : '');
		}
		const t: LinkTarget = start?.kind === 'quote'
			? { file: file.path, q: start.q, ...(start.qe ? { qe: start.qe } : {}), line: start.line }
			: { file: file.path, ref: refParam(start), end: refParam(end) };
		const key = linkConfig.register(t);
		if (key) return `${base}&h=${enc(key)}`;
	}
	return fullUri(app, file, start, end, nodes);
}

function fullUri(app: App, file: TFile, start?: Ref, end?: Ref, nodes?: string[]): string {
	let u = `obsidian://${JUMP_ACTION}?vault=${enc(app.vault.getName())}&file=${enc(file.path)}`;
	const s = refParam(start), e = refParam(end);
	if (s) u += `&ref=${enc(s)}`;
	if (e) u += `&end=${enc(e)}`;
	if (nodes?.length) u += `&nodes=${enc(nodes.join(','))}`;
	if (start?.kind === 'quote') {
		u += `&q=${enc(start.q)}&line=${start.line}`;
		if (start.qe) u += `&qe=${enc(start.qe)}`;
	}
	return u;
}

export function mdLink(label: string, uri: string) {
	return `[${label.replace(/[[\]]/g, '')}](${uri})`;
}

/* ------------------------------------------------------------------ */
/* Project name                                                        */
/* ------------------------------------------------------------------ */

/** "[[Example Note|alias]]" / "Example Note" / ["[[X]]"] → "Example Note" */
function linkName(v: unknown): string | undefined {
	const s = Array.isArray(v) ? v[0] : v;
	if (typeof s !== 'string' || !s.trim()) return undefined;
	const m = /^\s*\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(s);
	return (m ? m[1] : s).split('/').pop()!.replace(/\.md$/, '').trim() || undefined;
}

export function projectNameFor(app: App, file: TFile): string | undefined {
	if (file.extension === 'canvas') return file.basename;
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter ?? {};
	const type = String(fm.type ?? '').toLowerCase();
	const tags = ([] as string[]).concat(fm.tags ?? [], (cache?.tags ?? []).map(t => t.tag))
		.map(t => String(t).replace(/^#/, '').toLowerCase());
	// paper / reading notes: the reminder is about the paper, so use its title
	if (type === 'paper' || tags.includes('paper')) {
		const t = typeof fm.title === 'string' ? fm.title.trim() : '';
		return t || file.basename;
	}
	const explicit = linkName(fm.project ?? fm.Project);
	if (explicit) return explicit;
	if (type === 'project' || tags.includes('project')) return file.basename;
	return undefined;
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

export function markdownContext(app: App, editor: Editor, file: TFile): SelectionContext {
	const from = editor.getCursor('from');
	const to = editor.getCursor('to');
	const selected = editor.getSelection();
	const text = selected || editor.getLine(from.line);
	const lines = editor.getValue().split('\n');
	const heading = headingAbove(lines, from.line);
	const label = heading && heading !== file.basename ? `${file.basename} › ${heading}` : file.basename;

	return {
		source: 'markdown', app, file, text, label,
		title: cleanTitle(text) || file.basename,
		projectName: projectNameFor(app, file),
		getAnchor() {
			// Nothing is written into the note: the link remembers the selected text.
			const quote = makeQuote(selected || editor.getLine(from.line), from.line);
			const start: Ref = quote ? { kind: 'quote', ...quote } : { kind: 'file' };
			const uri = buildUri(app, file, start);
			return { uri, label, file, start, markdownLink: mdLink(label, uri) };
		},
	};
}

/* ------------------------------------------------------------------ */
/* Canvas (uses Obsidian's internal canvas API, guarded)               */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getCanvas(leafOrView: any): any | null {
	const view = leafOrView?.view ?? leafOrView;
	return view?.getViewType?.() === 'canvas' ? view.canvas ?? null : null;
}

function nodeData(n: any): any {
	return typeof n.getData === 'function' ? n.getData() : n;
}

function nodeText(n: any): string {
	const d = nodeData(n);
	if (d.type === 'text') return d.text ?? '';
	if (d.type === 'file') return (d.file ?? '').split('/').pop() ?? '';
	if (d.type === 'link') return d.url ?? '';
	if (d.type === 'group') return d.label ?? 'Group';
	return d.text ?? d.label ?? '';
}

export function canvasContext(app: App, view: any): SelectionContext | null {
	const canvas = getCanvas(view);
	const file: TFile | null = view?.file ?? null;
	if (!canvas || !file) return null;
	const nodes: any[] = Array.from(canvas.selection ?? []).filter((n: any) => n && !n.from && !n.to); // skip edges
	if (!nodes.length) return null;

	const text = nodes.map(nodeText).filter(Boolean).join('\n\n');
	const first = cleanTitle(nodeText(nodes[0]));
	const label = first ? `${file.basename} › ${first.slice(0, 40)}` : file.basename;
	const ids = nodes.map(n => n.id as string);

	return {
		source: 'canvas', app, file, text, label,
		title: cleanTitle(text) || file.basename,
		projectName: projectNameFor(app, file),
		getAnchor() {
			const uri = buildUri(app, file, undefined, undefined, ids);
			return { uri, label, file, nodes: ids, markdownLink: mdLink(label, uri) };
		},
	};
}

/* ------------------------------------------------------------------ */
/* Jumping back                                                        */
/* ------------------------------------------------------------------ */

function leafShowing(app: App, file: TFile): WorkspaceLeaf | null {
	let found: WorkspaceLeaf | null = null;
	app.workspace.iterateAllLeaves(l => {
		if (!found && (l.view as any)?.file?.path === file.path) found = l;
	});
	return found;
}

async function waitFor<T>(fn: () => T | null | undefined, ms = 3000): Promise<T | null> {
	const t0 = Date.now();
	for (;;) {
		const v = fn();
		if (v) return v;
		if (Date.now() - t0 > ms) return null;
		await new Promise(r => setTimeout(r, 50));
	}
}

async function findFallback(app: App, p: Record<string, string>): Promise<TFile | null> {
	// file was moved/renamed outside Obsidian: find it by its block id or node ids
	if (p.ref?.startsWith('^')) {
		const id = p.ref.slice(1).toLowerCase();
		for (const f of app.vault.getMarkdownFiles()) {
			if (app.metadataCache.getFileCache(f)?.blocks?.[id]) return f;
		}
	}
	if (p.nodes) {
		const want = p.nodes.split(',');
		for (const f of app.vault.getFiles().filter(f => f.extension === 'canvas')) {
			try {
				const data = JSON.parse(await app.vault.cachedRead(f));
				if (data.nodes?.some((n: any) => want.includes(n.id))) return f;
			} catch { /* not JSON */ }
		}
	}
	const base = (p.file ?? '').split('/').pop()?.replace(/\.(md|canvas)$/, '');
	return base ? app.metadataCache.getFirstLinkpathDest(base, '') : null;
}

// Links made before v0.3.0 point at headings that still carried a ⏰ marker;
// match them against the heading with or without it.
const OLD_MARKER = /\s*⏰$/;

function refRange(app: App, file: TFile, ref: string, editor: Editor, edge: 'start' | 'end') {
	const r = refRangeExact(app, file, ref, editor, edge);
	if (r || ref.startsWith('^') || !OLD_MARKER.test(ref)) return r;
	return refRangeExact(app, file, ref.replace(OLD_MARKER, ''), editor, edge);
}

function refRangeExact(app: App, file: TFile, ref: string, editor: Editor, edge: 'start' | 'end') {
	const cache = app.metadataCache.getFileCache(file);
	if (ref.startsWith('^')) {
		const b = cache?.blocks?.[ref.slice(1).toLowerCase()];
		if (b) return edge === 'start' ? b.position.start : b.position.end;
		// block ID removed from the note (v0.4 cleanup): use the text it was attached to
		const t = linkConfig.lookup(ref);
		if (t?.q) {
			const text = editor.getValue();
			const hit = findQuote(text, { q: t.q, qe: t.qe, line: t.line });
			if (hit) {
				const p = editor.offsetToPos(edge === 'start' ? hit.from : hit.to);
				return { line: p.line, col: p.ch };
			}
		}
	} else {
		const h = cache?.headings?.find(h => headingLinkText(h.heading) === ref || h.heading === ref);
		if (h) return edge === 'start' ? h.position.start : h.position.end;
	}
	// cache not updated yet: scan the editor
	for (let i = 0; i < editor.lineCount(); i++) {
		const l = editor.getLine(i);
		const hit = ref.startsWith('^') ? ID_TAIL.exec(l)?.[1] === ref.slice(1) || l.trim() === ref
			: /^#{1,6}\s/.test(l) && headingLinkText(l.replace(/^#{1,6}\s+/, '')) === ref;
		if (hit) return edge === 'start' ? { line: i, col: 0 } : { line: i, col: l.length };
	}
	return null;
}

/** Expand short-link params (k/e/n/h) into the full form (file/ref/end/nodes). */
export function expandParams(p: Record<string, string>): Record<string, string> {
	const q = { ...p };
	if (p.h) {
		const t = linkConfig.lookup(p.h);
		if (t) Object.assign(q, {
			file: t.file, ref: t.ref ?? '', end: t.end ?? '', nodes: t.nodes ?? '',
			q: t.q ?? '', qe: t.qe ?? '', line: t.line !== undefined ? String(t.line) : '',
		});
	}
	if (p.k) {
		q.ref = '^' + p.k; if (p.e) q.end = '^' + p.e;
		// pre-v0.4 link whose block ID was removed from the note: jump by its text instead
		const t = linkConfig.lookup('^' + p.k);
		if (t?.q) Object.assign(q, { file: t.file, q: t.q, qe: t.qe ?? '', line: t.line !== undefined ? String(t.line) : '' });
	}
	if (p.n) q.nodes = p.n;
	return q;
}

/**
 * Select the linked cards and zoom to them. The canvas API is internal and has
 * changed between releases (1.13 dropped addToSelection), so zoom to the cards'
 * combined bounding box directly, and treat selection as a bonus.
 */
export function focusCanvasNodes(canvas: any, nodes: any[]): void {
	try {
		if (nodes.length === 1 && typeof canvas.selectOnly === 'function') canvas.selectOnly(nodes[0]);
		else {
			canvas.deselectAll?.();
			const add = canvas.addToSelection ?? canvas.select;
			for (const n of nodes) add?.call(canvas, n);
		}
	} catch (e) { console.warn('[anchor-jump] canvas select', e); }

	const boxes = nodes.map(n => (typeof n.getBBox === 'function' ? n.getBBox()
		: { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height }));
	const bbox = {
		minX: Math.min(...boxes.map(b => b.minX)), minY: Math.min(...boxes.map(b => b.minY)),
		maxX: Math.max(...boxes.map(b => b.maxX)), maxY: Math.max(...boxes.map(b => b.maxY)),
	};
	if (typeof canvas.zoomToBbox === 'function') canvas.zoomToBbox(bbox);
	else if (canvas.selection?.size && typeof canvas.zoomToSelection === 'function') canvas.zoomToSelection();
}

export async function jumpToAnchor(app: App, raw: Record<string, string>): Promise<void> {
	const p = expandParams(raw);
	let file = app.vault.getAbstractFileByPath(p.file ?? '');
	if (!(file instanceof TFile)) file = await findFallback(app, p);
	if (!(file instanceof TFile)) { new Notice('Anchor: the linked note or canvas no longer exists.'); return; }

	const leaf = leafShowing(app, file) ?? app.workspace.getLeaf(false);
	await leaf.openFile(file, { active: true });
	app.workspace.setActiveLeaf(leaf, { focus: true });

	if (file.extension === 'canvas') {
		const ids = (p.nodes ?? '').split(',').filter(Boolean);
		const canvas = await waitFor(() => { const c = getCanvas(leaf); return c?.nodes?.size ? c : null; });
		if (!canvas || !ids.length) return;
		const nodes = ids.map(id => canvas.nodes.get(id)).filter(Boolean);
		if (!nodes.length) { new Notice('Anchor: that canvas card was deleted.'); return; }
		focusCanvasNodes(canvas, nodes);
		return;
	}

	if (p.q) return jumpToQuote(leaf, p);
	if (!p.ref) return;
	const view = await waitFor(() => (leaf.view instanceof MarkdownView ? leaf.view : null));
	if (!view) return;
	// Obsidian's own subpath handling scrolls + flashes the block
	view.setEphemeralState({ subpath: '#' + p.ref });
	if (view.getMode() !== 'source') return;
	const ed = view.editor;
	const a = refRange(app, file, p.ref, ed, 'start');
	const b = refRange(app, file, p.end || p.ref, ed, 'end');
	if (!a || !b) { new Notice('Anchor: the linked block was removed from this note.'); return; }
	const from = { line: a.line, ch: 0 };
	const to = { line: b.line, ch: ed.getLine(b.line).length };
	ed.setSelection(from, to);
	ed.scrollIntoView({ from, to }, true);
	ed.focus();
}

/** Text-quote links: find the remembered text again and select (or scroll to) it. */
async function jumpToQuote(leaf: WorkspaceLeaf, p: Record<string, string>): Promise<void> {
	const view = await waitFor(() => (leaf.view instanceof MarkdownView ? leaf.view : null));
	if (!view) return;
	const hint = parseInt(p.line ?? '', 10);
	const text = view.getViewData();
	const hit = findQuote(text, { q: p.q, qe: p.qe || undefined, line: isNaN(hint) ? 0 : hint });
	if (!hit || !hit.exact) new Notice(hit ? 'Anchor: the text changed a little — showing the closest match.' : 'Anchor: that text is no longer in the note — showing where it was.');
	if (view.getMode() === 'source') {
		const ed = view.editor;
		if (hit) {
			const from = ed.offsetToPos(hit.from), to = ed.offsetToPos(hit.to);
			ed.setSelection(from, to);
			ed.scrollIntoView({ from, to }, true);
		} else if (!isNaN(hint)) {
			const pos = { line: Math.min(hint, ed.lineCount() - 1), ch: 0 };
			ed.setCursor(pos);
			ed.scrollIntoView({ from: pos, to: pos }, true);
		}
		ed.focus();
		return;
	}
	// Reading view: scroll to the line
	const line = hit ? text.slice(0, hit.from).split('\n').length - 1 : hint;
	if (!isNaN(line)) view.setEphemeralState({ line });
}
