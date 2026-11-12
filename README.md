# Anchor Jump

Copy a link that jumps back to the **exact spot** you selected in Obsidian: a sentence, a list item, a heading, an image, or a canvas card. Nothing is ever written into your notes.

## Use

Select text in Source mode, Live Preview or Reading view (or select cards on a canvas), then run **Copy link to selection** from the command palette. You get a Markdown link such as `[Example Note › Heading](obsidian://anchor-jump?vault=…&h=8jv0ph)`. Opening it brings the note forward and selects the same spot, even after the text moved.

Only the command is provided. Bind it to a hotkey, or run it from another plugin's button.

### Link forms

- Short (default): `obsidian://anchor-jump?vault=…&h=<key>`. A text-quote anchor stored in the plugin's `data.json`; it survives note renames and edits.
- Full: spells out the note path and the anchor in the URL. Choose it under Settings → Anchor Jump → Link style.
- Canvas links use `n=<node ids>`. Older `k=`/`e=` block-id links still open.

## API for other plugins

```ts
interface SelectionInfo {
  source: 'markdown' | 'canvas'; file: TFile;
  text: string; title: string; label: string; projectName?: string;
}
interface AnchorLink { uri: string; markdownLink: string; label: string; }
interface AnchorJumpApi {
  readonly version: 1;
  // The selection, or the current line in the editor; null when there is nothing
  // (e.g. no markdown/canvas view)
  currentSelection(): SelectionInfo | null;
  linkFor(sel: SelectionInfo): Promise<AnchorLink>;  // sel must come from currentSelection()
}
```

```ts
const api = (this.app as any).plugins.getPlugin('anchor-jump')?.api as AnchorJumpApi | undefined;
if (api?.version !== 1) { new Notice('Needs the Anchor Jump plugin'); return; }
const sel = api.currentSelection();
if (sel) {
  const { uri, markdownLink } = await api.linkFor(sel);
}
```

Call `currentSelection()` at the moment the user acts, then pass that object to `linkFor`. `linkFor` never modifies the note.

## Migrating from Anchor Actions 0.4 and earlier

On first start, Anchor Jump imports the saved links (and link style) from `.obsidian/plugins/anchor-actions/data.json`, plus `legacy-ids.json` if present, and records `migratedFrom` so it never imports twice. Existing links keep working, because the protocol action is still `anchor-jump`. Your own links win over imported ones with the same key. Only one plugin should handle `obsidian://anchor-jump`, so disable Anchor Actions 0.4 when you enable this plugin.

## Development

```
npm install
npm test
npm run typecheck
npm run build   # → dist/main.js, manifest.json, styles.css
```

MIT licensed.
