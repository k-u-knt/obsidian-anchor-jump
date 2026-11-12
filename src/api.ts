import type { TFile } from 'obsidian';
import type { Anchor, SelectionContext } from './types';

export interface SelectionInfo {
	source: 'markdown' | 'canvas'; file: TFile;
	text: string; title: string; label: string; projectName?: string;
}
export interface AnchorLink { uri: string; markdownLink: string; label: string; }
export interface AnchorJumpApi {
	readonly version: 1;
	/** The selection, or the current line in the editor; null when there is nothing (e.g. no markdown/canvas view). */
	currentSelection(): SelectionInfo | null;
	/** `sel` must come from currentSelection(). Never modifies the note. */
	linkFor(sel: SelectionInfo): Promise<AnchorLink>;
}

// The anchor closure stays out of the enumerable fields of SelectionInfo.
const anchors = new WeakMap<SelectionInfo, () => Anchor | Promise<Anchor>>();

export function toSelectionInfo(ctx: SelectionContext): SelectionInfo {
	const info: SelectionInfo = { source: ctx.source, file: ctx.file, text: ctx.text, title: ctx.title, label: ctx.label };
	if (ctx.projectName !== undefined) info.projectName = ctx.projectName;
	anchors.set(info, () => ctx.getAnchor());
	return info;
}

export function createApi(current: () => SelectionContext | null): AnchorJumpApi {
	return {
		version: 1,
		currentSelection() {
			const ctx = current();
			return ctx ? toSelectionInfo(ctx) : null;
		},
		async linkFor(sel) {
			const get = anchors.get(sel);
			if (!get) throw new Error('Anchor Jump: pass a selection returned by currentSelection()');
			const a = await get();
			return { uri: a.uri, markdownLink: a.markdownLink, label: a.label };
		},
	};
}
