import { App, MarkdownPostProcessorContext, MarkdownView, TFile } from 'obsidian';
import { cleanTitle, headingAbove, listItemLine, Ref } from './blocks';
import { makeQuote } from './quote';
import { buildUri, mdLink, projectNameFor } from './anchor';
import type { SelectionContext } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/*
 * Reading view support. The rendered note is plain HTML, so a selection is
 * mapped back to source lines through the sections Obsidian renders: each
 * section element knows its start/end line (the renderer's section list;
 * the public post-processor context as a fallback).
 * Like the editor, nothing is written to the note: the link quotes the text.
 */

const sectionCtx = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();

/** Register with plugin.registerMarkdownPostProcessor to learn section line numbers. */
export function rememberSection(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
	sectionCtx.set(el, ctx);
}

interface Section { el: HTMLElement; lineStart: number; lineEnd: number }

function sectionsOf(view: MarkdownView): Section[] {
	const out: Section[] = [];
	const preview: any = (view as any).previewMode;
	const root: HTMLElement | undefined = preview?.containerEl;
	if (!root) return out;
	// the renderer's own section list: { el, start: {line}, end: {line} } (internal, guarded)
	const renderer = preview?.renderer;
	for (const s of (renderer?.sections ?? []) as any[]) {
		if (s === renderer.header || s === renderer.footer) continue;   // inline title / properties, backlinks
		const lineStart = s?.start?.line ?? s?.lineStart, lineEnd = s?.end?.line ?? s?.lineEnd;
		if (s?.el instanceof HTMLElement && s.el.isConnected && typeof lineStart === 'number' && typeof lineEnd === 'number') {
			out.push({ el: s.el, lineStart, lineEnd });
		}
	}
	if (!out.length) {
		// fallback: public API — the post-processor context of each rendered section
		root.querySelectorAll<HTMLElement>('.markdown-preview-sizer > div, .markdown-preview-section > div').forEach(el => {
			const info = sectionCtx.get(el)?.getSectionInfo(el);
			if (info) out.push({ el, lineStart: info.lineStart, lineEnd: info.lineEnd });
		});
	}
	return out.sort((a, b) => a.lineStart - b.lineStart);
}

function lineIn(lines: string[], s: Section, node: Node, edge: 'start' | 'end'): number {
	const el = node instanceof HTMLElement ? node : node.parentElement;
	const li = el?.closest('li[data-line]') as HTMLElement | null;
	if (li && s.el.contains(li)) {
		const dl = parseInt(li.dataset.line ?? '', 10);
		if (!isNaN(dl)) return listItemLine(lines, s.lineStart, s.lineEnd, dl);
	}
	return edge === 'start' ? s.lineStart : s.lineEnd;
}

/** The current selection inside this Reading view, or null. */
export function readingSelection(view: MarkdownView): Range | null {
	const root: HTMLElement | undefined = (view as any).previewMode?.containerEl;
	const sel = root?.ownerDocument.getSelection();
	if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return null;
	const range = sel.getRangeAt(0);
	if (!root.contains(range.commonAncestorContainer)) return null;
	return range;
}

export function readingContext(app: App, view: MarkdownView, range: Range): SelectionContext | null {
	const file: TFile | null = view.file;
	if (!file || view.getMode() !== 'preview') return null;
	const lines = view.getViewData().split('\n');
	const hit = sectionsOf(view).filter(s => range.intersectsNode(s.el));
	if (!hit.length) return null;
	const first = hit[0], last = hit[hit.length - 1];
	const fromLine = first.el.contains(range.startContainer) ? lineIn(lines, first, range.startContainer, 'start') : first.lineStart;
	let toLine = last.el.contains(range.endContainer) ? lineIn(lines, last, range.endContainer, 'end') : last.lineEnd;
	toLine = Math.max(fromLine, toLine);

	const text = range.toString().trim();
	const source = lines.slice(fromLine, toLine + 1).join('\n');
	const heading = headingAbove(lines, fromLine);
	const label = heading && heading !== file.basename ? `${file.basename} › ${heading}` : file.basename;

	return {
		source: 'markdown', app, file, label,
		text: text || source,
		title: cleanTitle(source) || cleanTitle(text) || file.basename,
		projectName: projectNameFor(app, file),
		getAnchor() {
			// Nothing is written into the note. Quote the exact source text when the
			// rendered selection appears verbatim in it, otherwise the selected blocks.
			const at = text ? source.indexOf(text) : -1;
			const quote = at >= 0
				? makeQuote(text, fromLine + source.slice(0, at).split('\n').length - 1)
				: makeQuote(source, fromLine);
			const start: Ref = quote ? { kind: 'quote', ...quote } : { kind: 'file' };
			const uri = buildUri(app, file, start);
			return { uri, label, file, start, markdownLink: mdLink(label, uri) };
		},
	};
}

/** Re-render open Reading views so the post-processor sees their sections. */
export function rerenderReadingViews(app: App) {
	app.workspace.getLeavesOfType('markdown').forEach(leaf => {
		const v = leaf.view;
		if (v instanceof MarkdownView && v.getMode() === 'preview') (v as any).previewMode?.rerender?.(true);
	});
}
