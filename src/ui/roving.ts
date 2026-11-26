// Roving-tabindex keyboard handling for a list of controls: one tab stop, arrow keys inside.

/**
 * The index to move to for `key`, or null when the key is not handled. Up/Down/Home/End move by one or to
 * the ends; PageUp/PageDown jump to the first item of the previous/next group (`groups[i]` is the group of
 * item i) and stay at the first or last group at the edges.
 */
export function nextIndex(
  current: number,
  count: number,
  key: string,
  groups?: readonly (string | null)[],
): number | null {
  if (current < 0 || current >= count) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(current + 1, count - 1);
    case 'ArrowUp':
      return Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'PageDown':
    case 'PageUp': {
      if (!groups) return null;
      const order = [...new Set(groups)];
      const at = order.indexOf(groups[current] ?? null);
      const target = order[key === 'PageDown' ? Math.min(at + 1, order.length - 1) : Math.max(at - 1, 0)];
      const index = groups.indexOf(target ?? null);
      return index < 0 ? null : index;
    }
    default:
      return null;
  }
}

/** Moves focus between `items()` on arrow, Home, End and (with `groupOf`) PageUp/PageDown. */
export function attachRoving(
  container: HTMLElement,
  items: () => readonly HTMLElement[],
  groupOf?: (item: HTMLElement) => string | null,
): void {
  container.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const list = items();
    const current = list.findIndex((item) => item === document.activeElement);
    const to = nextIndex(current, list.length, event.key, groupOf ? list.map(groupOf) : undefined);
    if (to === null) return;
    event.preventDefault();
    list[to]?.focus();
  });
}
