// Dropdown menus (.menu): only one open at a time, closed by clicking anywhere else.
import { $$ } from './dom.ts';

export function toggleMenu(menu: HTMLElement, force?: boolean) {
  const open = force ?? menu.hidden;
  $$('.menu').forEach(m => { m.hidden = true; });
  menu.hidden = !open;
}

document.addEventListener('click', () => $$('.menu').forEach(m => { m.hidden = true; }));
