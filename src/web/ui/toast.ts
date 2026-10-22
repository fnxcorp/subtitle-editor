// Short notifications. toast(msg, { error, undo }) — with undo, an "Undo" button is shown (wired in app.js).
import { $ } from './dom.ts';

let timer: ReturnType<typeof setTimeout> | undefined;

export interface ToastOptions { error?: boolean; undo?: boolean }

export function toast(msg: string, options: ToastOptions | boolean = {}) {
  const opts = typeof options === 'boolean' ? { error: options } : options;
  const el = $('#toast');
  $('#toast-msg').textContent = msg;
  $('#toast-undo').hidden = !opts.undo;
  el.classList.toggle('error', !!opts.error);
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, opts.undo ? 7000 : opts.error ? 4500 : 2500);
}

export function hideToast() {
  $('#toast').hidden = true;
}
