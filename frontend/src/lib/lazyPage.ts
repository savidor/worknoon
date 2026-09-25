import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'rd.reloadedForNewVersion';

/**
 * Lazy-loads a page. Page files have content hashes in their names, so after a new
 * deploy an already-open tab can ask for a file that no longer exists. When that happens
 * we reload once to pick up the new version; a session flag prevents reload loops.
 */
export function lazyPage<T extends ComponentType<object>>(load: () => Promise<T>) {
  return lazy(async () => {
    try {
      const page = await load();
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* storage unavailable */
      }
      return { default: page };
    } catch (err) {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, '1');
      } catch {
        /* storage unavailable: do not risk a loop */
      }
      if (!alreadyReloaded) {
        window.location.reload();
        return new Promise<never>(() => {}); // keep the spinner up while the page reloads
      }
      throw err;
    }
  });
}
