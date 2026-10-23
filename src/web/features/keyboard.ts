// Global keyboard dispatch: live timing first, then the command shortcuts.
import { isTyping } from '../ui/dom.ts';
import { handleLiveKey } from './live.ts';
import { keyMap, comboOf } from './commands.ts';
import { isCapturingShortcut } from './settings-dialog.ts';

document.addEventListener('keydown', e => {
  if (handleLiveKey(e)) return;
  if (e.isComposing || isCapturingShortcut() || document.querySelector('dialog[open]')) return;
  const combo = comboOf(e);
  const command = keyMap.get(combo);
  if (!command) return;
  // Keys without Alt/Cmd/Ctrl (Space, arrows, Delete…) never fire while typing
  const plain = !/(^|\+)(Meta|Ctrl|Alt)\+/.test(combo) && !/^(Shift\+)?(Escape|F\d+)$/.test(combo);
  // "Dead" = an accent key (Mac ⌥E → ´, ⌥N → ˜…): let the system compose the character
  if (isTyping(e.target) && (plain || !command.text || e.key === 'Dead')) return;
  e.preventDefault();
  command.run();
});

document.addEventListener('keyup', e => handleLiveKey(e));
