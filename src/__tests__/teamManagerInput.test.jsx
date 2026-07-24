// @vitest-environment jsdom
// チーム管理の選手登録が「1文字入力するたびに入力欄が作り直される」問題の回帰テスト。
// 行のkeyに選手名を含めると、入力のたびにReactが行をアンマウント/再マウントし、
// フォーカスと日本語入力(IME)の変換途中が失われてしまう。
// 再マウントされると元のDOMノードは文書から切り離されるため、
// 「同じノードが残り続けているか」で検証する。
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

// テキスト内容でボタンを探す(テスト用のDOM操作ヘルパー)
function findButton(root, text) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!btn) throw new Error(`ボタンが見つかりません: ${text}`);
  return btn;
}

// React管理下のinputへ、実際のキー入力と同じようにonChangeを発火させる
function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('チーム管理: 選手登録の入力', () => {
  let container;
  const textInputs = () => [...container.querySelectorAll('input[type="text"]')];
  const inputWithValue = (v) => textInputs().find((el) => el.value === v);

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<App />);
    });
    // 「👥 チーム」→「＋ 新規チーム登録」で選手一覧の編集画面まで進む
    await act(async () => { findButton(container, '👥 チーム').click(); });
    await act(async () => { findButton(container, '＋ 新規チーム登録').click(); });
  });

  it('1文字入力しても入力欄が作り直されずフォーカスが残る', async () => {
    const input = inputWithValue('選手1');
    expect(input).toBeTruthy();
    input.focus();
    expect(document.activeElement).toBe(input);

    await act(async () => { typeInto(input, '山'); });

    // 同じDOMノードが画面に残っている(=行が再マウントされていない)
    expect(container.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('山');
  });

  it('連続して入力しても値が積み上がりフォーカスを失わない', async () => {
    const input = inputWithValue('選手1');
    input.focus();

    for (const value of ['山', '山田', '山田太', '山田太郎']) {
      await act(async () => { typeInto(input, value); });
      expect(container.contains(input)).toBe(true);
      expect(document.activeElement).toBe(input);
    }

    expect(input.value).toBe('山田太郎');
    // 入力した名前が名簿(state)へ反映されている
    expect(inputWithValue('山田太郎')).toBe(input);
  });

  it('同名の選手がいても(重複ハイライト時も)入力欄が作り直されない', async () => {
    // 2番目の選手を1番目と同じ名前にすると、両方の行が重複としてハイライトされる
    const first = inputWithValue('選手1');
    const second = inputWithValue('選手2');
    first.focus();
    await act(async () => { typeInto(first, '選手2'); });

    expect(container.contains(first)).toBe(true);
    expect(container.contains(second)).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(first.value).toBe('選手2');
  });

  it('選手を追加した行にも続けて入力できる', async () => {
    await act(async () => { findButton(container, '＋ 選手を追加').click(); });
    const added = inputWithValue(''); // 追加直後は空欄
    expect(added).toBeTruthy();
    added.focus();

    for (const value of ['新', '新人']) {
      await act(async () => { typeInto(added, value); });
      expect(container.contains(added)).toBe(true);
      expect(document.activeElement).toBe(added);
    }
    expect(added.value).toBe('新人');
  });
});
