/** One-time import of links saved by Anchor Actions ≤ 0.4. Pure: no Obsidian imports. */
import type { LinkTarget } from './anchor';

export interface JumpData { linkStyle: 'short' | 'full'; links: Record<string, LinkTarget>; migratedFrom?: string; }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** iCloud's not-yet-downloaded stand-in for a file: same folder, leading dot, `.icloud` suffix. */
export function icloudPlaceholder(path: string): string {
	const i = path.lastIndexOf('/');
	return `${path.slice(0, i + 1)}.${path.slice(i + 1)}.icloud`;
}

/**
 * Merge the old plugin's data.json (`links`, `linkStyle`) and legacy-ids.json
 * into this plugin's data. Own entries always win; nothing is re-imported once
 * `migratedFrom` is set.
 *
 * With `opts.incomplete` (a source file exists but could not be read yet) the
 * readable parts are still merged, but the result is not stamped with
 * `migratedFrom` and `changed` is false, so the caller neither saves nor stops
 * retrying on the next load.
 */
export function migrateLinks(own: Partial<JumpData>, oldData: unknown, legacyIds: unknown, opts: { incomplete?: boolean } = {}): { data: JumpData; changed: boolean } {
	const data: JumpData = {
		linkStyle: own.linkStyle === 'full' ? 'full' : 'short',
		links: { ...(own.links ?? {}) },
		...(own.migratedFrom ? { migratedFrom: own.migratedFrom } : {}),
	};
	if (own.migratedFrom) return { data, changed: false };

	if (isObj(oldData)) {
		if (own.linkStyle === undefined && (oldData.linkStyle === 'short' || oldData.linkStyle === 'full')) data.linkStyle = oldData.linkStyle;
		if (isObj(oldData.links)) {
			for (const [k, v] of Object.entries(oldData.links)) {
				if (!(k in data.links) && isObj(v) && typeof v.file === 'string') data.links[k] = v as unknown as LinkTarget;
			}
		}
	}
	if (isObj(legacyIds)) {
		for (const [id, v] of Object.entries(legacyIds)) {
			const key = id.startsWith('^') ? id : '^' + id;
			if (!(key in data.links) && isObj(v) && typeof v.file === 'string' && v.q) data.links[key] = v as unknown as LinkTarget;
		}
	}
	if (opts.incomplete) return { data, changed: false };
	data.migratedFrom = 'anchor-actions';
	return { data, changed: true };
}
