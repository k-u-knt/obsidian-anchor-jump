import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { SelectionContext } from './types';
import { createApi, AnchorJumpApi } from './api';
import { JUMP_ACTION, jumpToAnchor, markdownContext, canvasContext, getCanvas, configureLinks } from './anchor';
import { randomId } from './blocks';
import { readingContext, readingSelection, rememberSection, rerenderReadingViews } from './reading';
import { JumpData, migrateLinks, icloudPlaceholder } from './migrate';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULTS: JumpData = { linkStyle: 'short', links: {} };
const OLD_PLUGIN_DIR = 'plugins/anchor-actions';
type ReadResult = { status: 'missing' } | { status: 'error' } | { status: 'ok'; value: unknown };

export default class AnchorJumpPlugin extends Plugin {
	data!: JumpData;
	api!: AnchorJumpApi;

	async onload() {
		await this.loadSettings();
		const plugin = this;
		configureLinks({
			get style() { return plugin.data.linkStyle; },   // live: follows the setting
			register: t => {
				const hit = Object.entries(this.data.links).find(([k, v]) => !k.startsWith('^') && v.file === t.file && v.ref === t.ref && v.end === t.end
					&& v.q === t.q && v.qe === t.qe && v.line === t.line && v.nodes === t.nodes);
				if (hit) return hit[0];
				let key = randomId();
				while (this.data.links[key]) key = randomId();
				this.data.links[key] = t;
				void this.saveData(this.data);
				return key;
			},
			lookup: k => this.data.links[k],
		});
		// keep the registry pointing at renamed/moved notes
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
			let changed = false;
			for (const v of Object.values(this.data.links)) if (v.file === oldPath) { v.file = f.path; changed = true; }
			if (changed) void this.saveData(this.data);
		}));

		// Reading view: map rendered sections back to source lines
		this.registerMarkdownPostProcessor((el, ctx) => rememberSection(el, ctx));
		this.app.workspace.onLayoutReady(() => rerenderReadingViews(this.app));

		this.registerObsidianProtocolHandler(JUMP_ACTION, p => jumpToAnchor(this.app, p as any).catch(e => {
			console.error('[anchor-jump]', e);
			new Notice('Anchor Jump: could not open the link — ' + (e as Error).message);
		}));

		this.api = createApi(() => this.activeContext());
		this.addCommand({
			id: 'copy-link',
			name: 'Copy link to selection',
			icon: 'link',
			checkCallback: checking => {
				const sel = this.api.currentSelection();
				if (!sel) return false;
				if (!checking) void this.copyLink(sel);
				return true;
			},
		});

		this.addSettingTab(new JumpSettingTab(this.app, this));
	}

	private async copyLink(sel: NonNullable<ReturnType<AnchorJumpApi['currentSelection']>>) {
		try {
			const link = await this.api.linkFor(sel);
			await navigator.clipboard.writeText(link.markdownLink);
			new Notice('Link to selection copied');
		} catch (e) {
			console.error('[anchor-jump]', e);
			new Notice(`Copy link failed: ${(e as Error).message}`);
		}
	}

	/** Context for the current note selection or canvas selection. */
	private activeContext(): SelectionContext | null {
		const md = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (md?.file && md.getMode() === 'source') return markdownContext(this.app, md.editor, md.file);
		if (md?.file && md.getMode() === 'preview') {
			const range = readingSelection(md);
			return range ? readingContext(this.app, md, range) : null;
		}
		const view = this.app.workspace.getMostRecentLeaf()?.view;
		if (getCanvas(view)) return canvasContext(this.app, view);
		return null;
	}

	async loadSettings() {
		const own = ((await this.loadData()) ?? {}) as Partial<JumpData>;
		let data: JumpData = { ...DEFAULTS, ...own, links: { ...(own.links ?? {}) } };
		if (!own.migratedFrom) {
			const dir = `${this.app.vault.configDir}/${OLD_PLUGIN_DIR}`;
			const a = await this.readJson(`${dir}/data.json`);
			const b = await this.readJson(`${dir}/legacy-ids.json`);
			const val = (r: ReadResult) => (r.status === 'ok' ? r.value : null);
			// An unreadable source must not be treated as "nothing to import": use what
			// we got, but leave migratedFrom unset and skip saving so the next load retries.
			const incomplete = a.status === 'error' || b.status === 'error';
			const r = migrateLinks(own, val(a), val(b), { incomplete });
			data = r.data;
			this.data = data;
			if (r.changed) await this.saveData(data);
			return;
		}
		this.data = data;
	}

	/** missing = genuinely absent; error = present but unreadable, unparseable or still an iCloud placeholder. */
	private async readJson(path: string): Promise<ReadResult> {
		try {
			const a = this.app.vault.adapter;
			if (!(await a.exists(path))) {
				if (await a.exists(icloudPlaceholder(path))) {
					console.warn('[anchor-jump] not downloaded from iCloud yet, will retry on next load:', path);
					return { status: 'error' };
				}
				return { status: 'missing' };
			}
			return { status: 'ok', value: JSON.parse(await a.read(path)) };
		} catch (e) { console.warn('[anchor-jump] could not read, will retry on next load:', path, e); return { status: 'error' }; }
	}

	async saveSettings() { await this.saveData(this.data); }
}

class JumpSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: AnchorJumpPlugin) { super(app, plugin); }

	display() {
		const { containerEl } = this;
		const d = this.plugin.data;
		containerEl.empty();
		new Setting(containerEl).setName('Link style')
			.setDesc('Short: obsidian://anchor-jump?vault=…&h=8jv0ph (the spot is stored in the plugin data and found anywhere in the vault). Full: spells out the note path.')
			.addDropdown(dd => dd.addOptions({ short: 'Short (recommended)', full: 'Full path' })
				.setValue(d.linkStyle).onChange(async v => {
					d.linkStyle = v as 'short' | 'full';
					await this.plugin.saveSettings();
				}));
	}
}
