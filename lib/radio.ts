/*
 * Radio groups made of buttons (role="radiogroup" around role="radio"), with
 * the keyboard of native radios: the group is one Tab stop (the chosen option,
 * or the first that can be chosen), and the arrow keys move the choice, and the
 * focus with it, to the next or previous option that isn't disabled, wrapping
 * round. Other elements in the group (a colour field) keep their own keys.
 */

/** The option that is the group's Tab stop (-1: none can be chosen). */
export function tabStop(options: readonly { checked: boolean; disabled?: boolean }[]): number {
  const i = options.findIndex((o) => o.checked && !o.disabled);
  return i >= 0 ? i : options.findIndex((o) => !o.disabled);
}

/** The group's keydown: an arrow key on one of its radios picks (and focuses) the next or previous one that isn't disabled. */
export function radioKeys(e: { key: string; target: EventTarget | null; currentTarget: EventTarget | null; preventDefault(): void }, pick: (i: number) => void) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  const group = e.currentTarget as HTMLElement | null;
  const from = (e.target as Element | null)?.closest?.('[role="radio"]');
  if (!step || !group || !from) return;
  e.preventDefault();
  const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const at = radios.indexOf(from as HTMLButtonElement);
  for (let k = 1; k < radios.length; k++) {
    const i = (at + step * k + radios.length * k) % radios.length;
    if (radios[i].disabled) continue;
    pick(i);
    radios[i].focus();
    return;
  }
}
