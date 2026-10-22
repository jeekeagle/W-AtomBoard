import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotes } from '../src/getnote.mjs';

test('normalizeNotes 处理 {data:{results:[...]}} 结构', () => {
  const out = normalizeNotes({
    data: {
      results: [
        {
          note_id: 'n-1',
          title: '第一篇',
          snippet: '摘要内容',
          score: 0.9,
        },
      ],
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'n-1');
  assert.equal(out[0].title, '第一篇');
  assert.equal(out[0].snippet, '摘要内容');
  assert.equal(out[0].score, 0.9);
});

test('normalizeNotes 处理裸数组与 notes / data 包装', () => {
  const bare = normalizeNotes([{ id: 'a', title: 'A', content: 'x' }]);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].id, 'a');

  const notes = normalizeNotes({ notes: [{ note_id: 'b', display_title: 'B' }] });
  assert.equal(notes[0].id, 'b');
  assert.equal(notes[0].title, 'B');

  const data = normalizeNotes({ data: [{ note_id: 'c', title: 'C' }] });
  assert.equal(data[0].id, 'c');
});

test('normalizeNotes 无标题时给出占位标题', () => {
  const out = normalizeNotes([{ note_id: 'n', content: '只有正文' }]);
  assert.equal(out[0].title, '(无标题)');
});

test('normalizeNotes 优先取嵌套 note 对象里的字段', () => {
  const out = normalizeNotes([{
    note: { note_id: 'n-9', title: '嵌套标题', content_state: { content: '嵌套正文' } },
    snippet: '外层摘要',
  }]);
  assert.equal(out[0].id, 'n-9');
  assert.equal(out[0].title, '嵌套标题');
  assert.equal(out[0].snippet, '外层摘要');
});

test('normalizeNotes 对空输入返回空数组', () => {
  assert.deepEqual(normalizeNotes(null), []);
  assert.deepEqual(normalizeNotes(undefined), []);
  assert.deepEqual(normalizeNotes({}), []);
  assert.deepEqual(normalizeNotes({ data: { results: [] } }), []);
});
