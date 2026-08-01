// @vitest-environment jsdom
// 指名打者制の画面操作テスト。
// ・指名打者制のオーダーでは投手が「控/投」に入り、打席に立たないこと
// ・出場中の野手が投手になると指名打者制が解除され、投手が指名打者の打順に入ること
// ・交代モーダルの「DH解除」で、投手を指名打者の打順へ入れられること
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

function findButton(root, text) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!btn) throw new Error(`ボタンが見つかりません: ${text}`);
  return btn;
}

// 5番が左翼、3番が指名打者、「控/投」に先発投手を置いた指名打者制のオーダー
const dhLineup = (prefix) => [
  { order: 1, name: `${prefix}1`, pos: '中', throws: '右', bats: '右' },
  { order: 2, name: `${prefix}2`, pos: '遊', throws: '右', bats: '右' },
  { order: 3, name: `${prefix}3`, pos: '指', throws: '右', bats: '右' },
  { order: 4, name: `${prefix}4`, pos: '一', throws: '右', bats: '右' },
  { order: 5, name: `${prefix}5`, pos: '左', throws: '右', bats: '右' },
  { order: 6, name: `${prefix}6`, pos: '三', throws: '右', bats: '右' },
  { order: 7, name: `${prefix}7`, pos: '右', throws: '右', bats: '右' },
  { order: 8, name: `${prefix}8`, pos: '二', throws: '右', bats: '右' },
  { order: 9, name: `${prefix}9`, pos: '捕', throws: '右', bats: '右' },
  { order: '投', name: `${prefix}先発P`, pos: '投', throws: '右', bats: '右' },
];

const storedLineups = () => JSON.parse(localStorage.getItem('baseball_lineups_v2'));
const storedPitches = () => JSON.parse(localStorage.getItem('baseball_pitches_v2'));
const subModal = (container) => [...container.querySelectorAll('div')].find((d) => d.querySelector(':scope > div > h2')?.textContent.includes('選手交代'));

describe('指名打者制', () => {
  let container;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('baseball_lineups_v2', JSON.stringify({ top: dhLineup('自'), bottom: dhLineup('敵') }));
    localStorage.setItem('baseball_pitches_v2', JSON.stringify([]));
    localStorage.setItem('baseball_gameInfo_v2', JSON.stringify({ date: '2026-07-25', gameType: '練習試合', teamTop: '自チーム', teamBottom: '相手チーム' }));
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });
  });

  it('オーダー設定に指名打者制の状態を表示する', async () => {
    await act(async () => { findButton(container, '⚙️ オーダー').click(); });
    expect(container.textContent).toContain('指名打者制');
    expect(container.textContent).toContain('3番 自3／投手 自先発P（打席に立たない）');
    // 正しい設定なので警告は出ない
    expect(container.textContent).not.toContain('⚠️ 指名打者');
  });

  it('指名打者制では投手が打席に立たず、指名打者が3番に入る', () => {
    // 先攻の攻撃中。現在の打者は1番、相手投手は「控/投」の先発投手
    expect(container.textContent).toContain('敵先発P');
    const top = storedLineups().top;
    expect(top[2].pos).toBe('指');
    expect(top[9].pos).toBe('投');
  });

  it('出場中の野手が投手になると指名打者制が解除され、元投手が指名打者の打順に入る', async () => {
    await act(async () => { findButton(container, '🔄 交代').click(); });
    // 位置変更で5番の左翼手をマウンドへ(玉突きで元投手が左翼へ回る)
    await act(async () => { findButton(subModal(container), '位置変更').click(); });
    const orderSelect = subModal(container).querySelector('select');
    await act(async () => {
      orderSelect.value = '5';
      orderSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // 「移動先のポジション」から投を選ぶ
    const posArea = [...subModal(container).querySelectorAll('div')].find((d) => d.textContent.startsWith('移動先のポジション'));
    await act(async () => { findButton(posArea, '投').click(); });
    await act(async () => { findButton(subModal(container), '交代を実行').click(); });

    const top = storedLineups().top;
    // 5番が投手になり、指名打者制は解除される
    expect(top[4].pos).toBe('投');
    // 元投手が指名打者(3番)の打順に入り、指名打者は退く
    expect(top[2].name).toBe('自先発P');
    expect(top[2].pos).toBe('左');
    // 「控/投」は空になる
    expect(top[9].name).toBe('');

    // 位置変更とDH解除の2件が記録に残る
    const events = storedPitches().map((p) => p.result);
    expect(events.some((t) => t.includes('(位置変更)'))).toBe(true);
    expect(events.some((t) => t.includes('(DH解除)') && t.includes('自先発P'))).toBe(true);
  });

  it('「DH解除」で投手を指名打者の打順に入れられる', async () => {
    await act(async () => { findButton(container, '🔄 交代').click(); });
    await act(async () => { findButton(subModal(container), 'DH解除').click(); });
    // 既定で指名打者の打順(3番)が対象になる
    expect(subModal(container).textContent).toContain('投手 自先発P が3番の打順に入り、自3 は退きます');
    await act(async () => { findButton(subModal(container), '交代を実行').click(); });

    const top = storedLineups().top;
    expect(top[2].name).toBe('自先発P');
    expect(top[2].pos).toBe('投');
    expect(top[9].name).toBe('');
    expect(storedPitches().at(-1).result).toContain('(DH解除)');
  });

  it('さかのぼって野手を投手にすると、その場面からDH解除が挿入され以降の記録も書き換わる', async () => {
    // 3番(指名打者)が1回・4回・6回に打っている記録を用意する
    const pa = (over) => ({
      inning: 1, isTop: true, batter: 3, isEvent: false, pitchNumber: 1, result: '三振', course: 24, type: 'ストレート',
      batterName: '自3', batterBats: '右', batterThrows: '右', batterPos: '指',
      pitcherName: '敵先発P', pitcherThrows: '右',
      runners: { first: false, second: false, third: false }, outs: 0, ...over,
    });
    localStorage.setItem('baseball_pitches_v2', JSON.stringify([
      pa({ inning: 1 }), pa({ inning: 4, result: '右前安打' }), pa({ inning: 6, result: '二ゴロ' }),
    ]));
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });

    // 4回の記録(index 1)の直前へ「位置変更: 5番 左→投」を挿入する
    await act(async () => { findButton(container, '📝 記録修正').click(); });
    const insertButtons = [...container.querySelectorAll('button')].filter((b) => b.textContent.includes('交代挿入'));
    await act(async () => { insertButtons[1].click(); });
    await act(async () => { findButton(subModal(container), '位置変更').click(); });
    const orderSelect = subModal(container).querySelector('select');
    await act(async () => {
      orderSelect.value = '5';
      orderSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const posArea = [...subModal(container).querySelectorAll('div')].find((d) => d.textContent.startsWith('移動先のポジション'));
    await act(async () => { findButton(posArea, '投').click(); });
    await act(async () => { findButton(container, 'この場面に挿入').click(); });

    const records = storedPitches();
    // 位置変更とDH解除の2件が、1回の打席と4回の打席の間に入る
    expect(records[1].result).toContain('(位置変更)');
    expect(records[2].result).toContain('(DH解除)');
    // 挿入前の記録はそのまま、挿入後の3番は元投手の記録に書き換わる
    expect(records[0].batterName).toBe('自3');
    expect(records.slice(3).map((p) => p.batterName)).toEqual(['自先発P', '自先発P']);
  });

  it('指名打者制でないチームには「DH解除」を出さない', async () => {
    // 後攻の指名打者を外し、投手が打順に入っている状態にする
    const bottom = dhLineup('敵');
    bottom[2] = { ...bottom[2], pos: '投', name: '敵3' };
    bottom[9] = { order: '投', name: '', pos: '控', throws: '右', bats: '右' };
    localStorage.setItem('baseball_lineups_v2', JSON.stringify({ top: dhLineup('自'), bottom }));
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => { createRoot(container).render(<App />); });

    await act(async () => { findButton(container, '🔄 交代').click(); });
    // 先攻(指名打者制)では選べる
    expect(subModal(container).textContent).toContain('DH解除');
    await act(async () => { findButton(subModal(container), '相手チーム').click(); });
    expect(subModal(container).textContent).not.toContain('DH解除');
  });
});
