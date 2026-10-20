const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PerformanceSession, advanceScroll } = require('../src/ChordLibrary.Shared/wwwroot/js/performance.js');
const songs = [{ id:'a', title:'A', content:'C|', twoColumn:false }, { id:'b', title:'B', content:'G|' }];
test('snapshot preserves duplicate occurrences and skips unresolved entries', () => {
  const session = new PerformanceSession(songs, ['a', 'missing', 'b', 'a'], 2);
  assert.equal(session.missing, 1);
  assert.deepEqual(session.entries.map(e => e.song.id), ['a','b','a']);
  assert.equal(session.index, 2);
  session.current.song.content = 'Changed';
  assert.equal(songs[0].content, 'C|');
  assert.equal(session.entries[0].song.content, 'C|');
});
test('navigation is bounded and preserves independent positions for repeated songs', () => {
  const session = new PerformanceSession(songs, ['a','b','a']);
  assert.equal(session.move(-1, 100), false);
  assert.equal(session.move(1, 120), true);
  assert.equal(session.move(1, 240), true);
  assert.equal(session.move(1, 360), false);
  assert.equal(session.move(-1, 360), true);
  assert.equal(session.current.scroll, 240);
  session.move(-1, 250);
  assert.equal(session.current.scroll, 120);
  session.patch({transposeSteps:3});
  assert.equal(session.entries[2].song.transposeSteps, 3);
  assert.equal(songs[0].transposeSteps, undefined);
});
test('empty session and extreme starting positions are safe', () => {
  assert.equal(new PerformanceSession([], ['missing']).current, undefined);
  assert.equal(new PerformanceSession(songs,['a','b'],99).index, 1);
});
test('elapsed-time scrolling is frame independent and bounded at bottom', () => {
  for (let speed=0; speed<5; speed++) {
    let a=0,b=0;
    for(let i=0;i<10;i++) a=advanceScroll(a,100,speed,1000);
    for(let i=0;i<100;i++) b=advanceScroll(b,10,speed,1000);
    assert.ok(Math.abs(a-b)<0.001);
  }
  assert.equal(advanceScroll(99,100,4,100),100);
  assert.equal(advanceScroll(10,-100,2,100),10);
  assert.equal(advanceScroll(10,60000,2,100),12.4);
});
