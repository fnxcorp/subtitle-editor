// Entry point. The dictionary is loaded first because modules translate labels when they load.
import { loadLanguage } from './core/i18n.ts';

await loadLanguage();
await import('./app.ts');
