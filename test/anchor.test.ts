import assert from 'node:assert/strict';
import { makeQuote, findQuote } from '../src/quote';
import { migrateLinks, icloudPlaceholder } from '../src/migrate';
import { planAnchor, applyEdits, segment, cleanTitle, headingAbove, headingLinkText, listItemLine } from '../src/blocks';

let n = 0;
const ids = () => { let k = 0; return () => `id${++k}`; };
function t(name: string, fn: () => void) { fn(); n++; console.log('ok -', name); }
const L = (s: string) => s.split('\n');

const doc = L(`---
type: project
---
# Demo Project

## 💡Description
Applying the method
to the sample.

## 🚀Progress
### 2026-09-28
Working on the final push of the manuscript. What i need to do is
- [ ] citation insertion
- [ ] sort out things to do:
    continuation line

| a | b |
|---|---|
| 1 | 2 |
next para

\`\`\`python
x = 1
\`\`\`

> [!note] Callout
> body

![[figure1.png]]

Para with id ^abc123`);

t('segment finds expected block types', () => {
	const types = segment(doc).map(b => `${b.type}@${b.start}`);
	assert.deepEqual(types, [
		'frontmatter@0', 'heading@3', 'heading@5', 'paragraph@6', 'heading@9', 'heading@10',
		'paragraph@11', 'listItem@12', 'listItem@13', 'table@16', 'paragraph@19',
		'code@21', 'quote@25', 'paragraph@28', 'paragraph@30',
	]);
});

t('paragraph: id appended to last line, nothing else', () => {
	const p = planAnchor(doc, 6, 6, { newId: ids() });
	assert.deepEqual(p.start, { kind: 'block', id: 'id1' });
	assert.equal(p.end, undefined);
	const out = applyEdits(doc, p.edits);
	assert.equal(out[7], 'to the sample. ^id1');
	assert.equal(out[6], 'Applying the method');
});

t('screenshot case: heading → list item spans two anchors', () => {
	const p = planAnchor(doc, 10, 13, { newId: ids() });
	assert.deepEqual(p.start, { kind: 'heading', text: '2026-09-28' });
	assert.deepEqual(p.end, { kind: 'block', id: 'id1' });
	const out = applyEdits(doc, p.edits);
	assert.equal(out[10], '### 2026-09-28'); // headings are never modified
	assert.equal(out[14], '    continuation line ^id1'); // end of the item, not the bullet line
});

t('single list item gets inline id', () => {
	const p = planAnchor(doc, 12, 12, { newId: ids() });
	assert.equal(applyEdits(doc, p.edits)[12], '- [ ] citation insertion ^id1');
});

t('table: id on own line with blank lines around', () => {
	const p = planAnchor(doc, 17, 17, { newId: ids() });
	const out = applyEdits(doc, p.edits);
	assert.deepEqual(out.slice(16, 23), ['| a | b |', '|---|---|', '| 1 | 2 |', '', '^id1', '', 'next para']);
	// re-segmenting picks the id back up, and the paragraph after is intact
	const again = planAnchor(out, 17, 17, { newId: ids() });
	assert.deepEqual(again.start, { kind: 'block', id: 'id1' });
	assert.equal(again.edits.length, 0);
});

t('code block and callout', () => {
	let out = applyEdits(doc, planAnchor(doc, 22, 22, { newId: ids() }).edits);
	assert.deepEqual(out.slice(21, 26), ['```python', 'x = 1', '```', '', '^id1']);
	out = applyEdits(doc, planAnchor(doc, 26, 26, { newId: ids() }).edits);
	assert.deepEqual(out.slice(25, 29), ['> [!note] Callout', '> body', '', '^id1']);
});

t('image embed line', () => {
	const out = applyEdits(doc, planAnchor(doc, 28, 28, { newId: ids() }).edits);
	assert.equal(out[28], '![[figure1.png]] ^id1');
});

t('existing id reused, note untouched (re-registering adds nothing)', () => {
	const p = planAnchor(doc, 30, 30, { newId: ids() });
	assert.deepEqual(p.start, { kind: 'block', id: 'abc123' });
	assert.equal(p.edits.length, 0);
	const once = applyEdits(doc, planAnchor(doc, 6, 6, { newId: ids() }).edits);
	const twice = applyEdits(once, planAnchor(once, 6, 6, { newId: ids() }).edits);
	assert.deepEqual(twice, once);
	const h1 = applyEdits(doc, planAnchor(doc, 10, 10, { newId: ids() }).edits);
	assert.deepEqual(h1, doc);
});

t('blank line / frontmatter fall forward to next block', () => {
	assert.deepEqual(planAnchor(doc, 1, 1, { newId: ids() }).start, { kind: 'heading', text: 'Demo Project' });
	assert.deepEqual(planAnchor(doc, 4, 4, { newId: ids() }).start, { kind: 'heading', text: '💡Description' });
});

t('empty doc → file ref', () => {
	assert.deepEqual(planAnchor([''], 0, 0).start, { kind: 'file' });
});

t('edits for two blocks apply cleanly bottom-up', () => {
	const p = planAnchor(doc, 6, 19, { newId: ids() });
	const out = applyEdits(doc, p.edits);
	assert.equal(out[7], 'to the sample. ^id1');
	assert.equal(out[19], 'next para ^id2');
});

t('reading view: <li data-line> resolves to the source line', () => {
	// list section spans lines 12-14 of doc ("- [ ] citation…", "- [ ] sort out…", continuation)
	assert.equal(listItemLine(doc, 12, 14, 0), 12);   // section-relative offsets
	assert.equal(listItemLine(doc, 12, 14, 1), 13);
	assert.equal(listItemLine(doc, 12, 14, 13), 13);  // absolute offset also accepted
	assert.equal(listItemLine(doc, 12, 14, 99), 12);  // nonsense → section start
	// a reading-view selection of the 2nd item anchors that item only
	const p = planAnchor(doc, listItemLine(doc, 12, 14, 1), listItemLine(doc, 12, 14, 1), { newId: ids() });
	assert.equal(applyEdits(doc, p.edits)[14], '    continuation line ^id1');
	assert.equal(p.end, undefined);
});

t('titles and headings', () => {
	assert.equal(cleanTitle('### 2026-09-28\nWorking on the **final** push ^x1\n- [ ] a'), 'Working on the final push');
	assert.equal(cleanTitle('- [ ] sample [[Example|citation]] insertion'), 'sample citation insertion');
	assert.equal(cleanTitle('![[0_Assets/fig 1.png|300]]'), 'fig 1.png');
	assert.equal(cleanTitle('## Only heading'), 'Only heading');
	// selection from a note's H1 down: the H1 is the title, not the first list item
	assert.equal(cleanTitle('# A long example title about something\n\n## 🔗Links\n- Source: ⚠ **not added yet** — add it'),
		'A long example title about something');
	assert.equal(cleanTitle('## 🔗Links\n- DOI: [x](https://doi.org/1)'), 'DOI: x');
	assert.equal(headingAbove(doc, 13), '2026-09-28');
	assert.equal(headingLinkText('Aim 1: Demo [draft] ##'), 'Aim 1 Demo draft');
});

t('quote anchors: nothing written, text found again', () => {
	const note = doc.join('\n');
	const sel = 'citation insertion';
	const q = makeQuote(sel, 12)!;
	assert.deepEqual(q, { q: sel, line: 12 });
	const hit = findQuote(note, q)!;
	assert.equal(note.slice(hit.from, hit.to), sel);
	assert.equal(hit.exact, true);
	// repeated text: the occurrence nearest the original line wins
	const twice = 'alpha\nsame text\nbeta\ngamma\nsame text\nend';
	const h2 = findQuote(twice, { q: 'same text', line: 4 })!;
	assert.equal(twice.slice(0, h2.from).split('\n').length - 1, 4);
	// text inserted above: still found
	const moved = 'new line\nanother\n' + note;
	assert.equal(moved.slice(findQuote(moved, q)!.from).startsWith(sel), true);
	// edited selection: falls back to its first words
	const edited = note.replace('Working on the final push of the manuscript.', 'Working on the final push of the paper.');
	const h3 = findQuote(edited, { q: 'Working on the final push of the manuscript.', line: 11 })!;
	assert.equal(h3.exact, false);
	assert.ok(edited.slice(h3.from).startsWith('Working on the final push'));
	// long selection keeps head + tail and re-selects the whole span
	const long = 'x'.repeat(50) + ' ' + 'middle '.repeat(200) + 'the end.';
	const lq = makeQuote(long, 0)!;
	assert.ok(lq.qe && lq.q.length === 300);
	const lh = findQuote('before\n' + long + '\nafter', lq)!;
	assert.equal(lh.to - lh.from, long.length);
	// gone entirely
	assert.equal(findQuote(note, { q: 'this text does not exist anywhere', line: 3 }), null);
});

const item = { file: 'x.md', q: 'hi', line: 1 };

t('migrate: imports old links and style, marks source', () => {
	const r = migrateLinks({}, { linkStyle: 'full', links: { a: item } }, null);
	assert.deepEqual(r.data.links.a, item);
	assert.equal(r.data.linkStyle, 'full');
	assert.equal(r.data.migratedFrom, 'anchor-actions');
	assert.equal(r.changed, true);
});

t('migrate: already migrated → no re-import', () => {
	const r = migrateLinks({ migratedFrom: 'anchor-actions', links: {} }, { links: { a: item } }, null);
	assert.equal(r.changed, false);
	assert.deepEqual(r.data.links, {});
});

t('migrate: merge without overwriting own links', () => {
	const r = migrateLinks({ links: { a: { file: 'new.md' } } }, { links: { a: { file: 'old.md' }, b: { file: 'b.md' } } }, null);
	assert.equal(r.data.links.a.file, 'new.md');
	assert.equal(r.data.links.b.file, 'b.md');
});

t('migrate: legacy ids get a ^ prefix, incomplete entries are skipped', () => {
	const r = migrateLinks({}, null, {
		'^x1': { file: 'n.md', q: 't', line: 3 },
		'y2': { file: 'n.md', q: 'u', line: 4 },
		'z3': { file: 'n.md', line: 5 },
	});
	assert.deepEqual(r.data.links['^x1'], { file: 'n.md', q: 't', line: 3 });
	assert.deepEqual(r.data.links['^y2'], { file: 'n.md', q: 'u', line: 4 });
	assert.equal('^z3' in r.data.links, false);
	assert.equal('z3' in r.data.links, false);
});

t('migrate: null or garbage old data → defaults', () => {
	for (const bad of [null, undefined, 'junk', 42, [], { links: 'no', linkStyle: 'weird' }]) {
		const r = migrateLinks({}, bad, null);
		assert.equal(r.data.linkStyle, 'short');
		assert.deepEqual(r.data.links, {});
		assert.equal(r.data.migratedFrom, 'anchor-actions');
	}
});

t('migrate: incomplete read merges what it has but does not stamp or save', () => {
	const r = migrateLinks({}, { linkStyle: 'full', links: { a: item } }, null, { incomplete: true });
	assert.deepEqual(r.data.links.a, item);
	assert.equal(r.data.linkStyle, 'full');
	assert.equal('migratedFrom' in r.data, false);
	assert.equal(r.changed, false);
});

t('migrate: incomplete with nothing readable → empty, unstamped, retried later', () => {
	const r = migrateLinks({}, null, null, { incomplete: true });
	assert.deepEqual(r.data.links, {});
	assert.equal(r.data.migratedFrom, undefined);
	assert.equal(r.changed, false);
});

t('migrate: incomplete is ignored once already migrated', () => {
	const r = migrateLinks({ migratedFrom: 'anchor-actions' }, { links: { a: item } }, null, { incomplete: true });
	assert.deepEqual(r.data.links, {});
	assert.equal(r.data.migratedFrom, 'anchor-actions');
});

t('icloudPlaceholder: leading dot, same folder', () => {
	assert.equal(icloudPlaceholder('.obsidian/plugins/anchor-actions/data.json'), '.obsidian/plugins/anchor-actions/.data.json.icloud');
	assert.equal(icloudPlaceholder('legacy-ids.json'), '.legacy-ids.json.icloud');
});

console.log(`\n${n} tests passed`);
