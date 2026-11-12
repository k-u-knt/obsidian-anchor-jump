import type { App, TFile } from 'obsidian';
import type { Ref } from './blocks';

/** A stable pointer back to the exact place a selection came from. */
export interface Anchor {
	uri: string;              // obsidian://anchor-jump?... (opens and selects the spot)
	markdownLink: string;     // [label](uri)
	label: string;            // "Note › Heading" or "Canvas › card text"
	file: TFile;
	start?: Ref;
	end?: Ref;
	nodes?: string[];         // canvas node ids
}

/**
 * What the selection readers produce. Creating the anchor is lazy: block IDs are
 * only written into the note when an action asks for them.
 */
export interface SelectionContext {
	source: 'markdown' | 'canvas';
	app: App;
	file: TFile;
	/** selected text (markdown) or card text / file names (canvas) */
	text: string;
	/** suggested short title for the selection */
	title: string;
	/** human-readable origin, e.g. "Example Note › 2026-09-28" */
	label: string;
	/**
	 * Project the selection belongs to, if known: the paper's title for paper
	 * notes (`type: paper` or tagged #paper), a note's `project:` property,
	 * the note itself when it is `type: project` (or tagged #project), or the
	 * canvas name for canvases.
	 */
	projectName?: string;
	/** Insert block ids where needed and return a link back here. */
	getAnchor(): Anchor | Promise<Anchor>;
}
