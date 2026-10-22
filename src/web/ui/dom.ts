// DOM shortcuts and the elements several modules share.

// Elements are looked up by selectors that exist in index.html, so null is not expected.
// Pass the element type when you need its specific properties: $<HTMLInputElement>('#offset').value
export const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document): T => el.querySelector(s) as T;
export const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document): T[] => [...el.querySelectorAll<T>(s)];
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export const video = $<HTMLVideoElement>('#video');
export const listEl = $('#cue-list');

// True when the keyboard focus is in a text field (shortcuts without modifiers must not fire)
export function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || (el instanceof HTMLInputElement && !['range', 'checkbox', 'button', 'file'].includes(el.type));
}
