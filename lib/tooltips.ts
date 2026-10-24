/*
 * Tooltips for every `[data-tip]` element: one shared element shown in the top
 * layer (Popover API), so no pane's `overflow: hidden`, containment, dialog or
 * fullscreen view can clip or cover it. Placed under the element (`data-tip-up`:
 * above), flipped when there is no room and kept inside the window.
 *
 * Shown after a short hover with a mouse or pen (never for touch) and on keyboard
 * focus; hidden on leave, blur, any press, Esc, scroll and resize. Not shown when
 * the element already shows the same text (a label that fits) or inside `.tv-acts`.
 *
 * A tooltip can state facts about the document ("34% smaller", counts): when its
 * element has PRIVATE_LABELS or sits inside a PRIVATE element, the shared one is
 * PRIVATE too (session replay never reads it) for as long as it holds that text.
 */
import { PRIVATE, PRIVATE_LABELS } from './analytics';

const DELAY = 400;
const SECRET = `.${PRIVATE}, .${PRIVATE_LABELS}`;
const GAP = 7;
const EDGE = 8;

export function startTooltips(): () => void {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  // Older browsers (before Chrome 114, Safari 17, Firefox 125): a fixed element on the page instead.
  const popover = typeof (tip as Partial<HTMLElement>).showPopover === 'function';
  if (popover) tip.setAttribute('popover', 'manual');
  tip.hidden = !popover;
  document.body.append(tip);

  let target: HTMLElement | null = null;
  let timer = 0;

  const textOf = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text || el.closest('.tv-acts')) return null;
    return el.innerText.trim() === text ? null : text;
  };

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const below = r.bottom + GAP;
    const above = r.top - GAP - h;
    const up = 'tipUp' in el.dataset ? above >= EDGE || below + h > vh - EDGE : below + h > vh - EDGE && above >= EDGE;
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), vw - EDGE - w);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(up ? above : below)}px`;
  };

  const show = (el: HTMLElement) => {
    const text = textOf(el);
    if (!text || !el.isConnected) return;
    // Protected before the text goes in; the last private text gone before protection comes off.
    if (el.closest(SECRET)) tip.classList.add(PRIVATE);
    else if (tip.classList.contains(PRIVATE)) {
      tip.textContent = '';
      tip.classList.remove(PRIVATE);
    }
    tip.textContent = text;
    tip.classList.remove('in');
    if (popover) {
      if (tip.matches(':popover-open')) tip.hidePopover();
      tip.showPopover();
    } else tip.hidden = false;
    place(el);
    void tip.offsetWidth;
    tip.classList.add('in');
  };

  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.classList.remove('in');
    if (popover) {
      if (tip.matches(':popover-open')) tip.hidePopover();
    } else tip.hidden = true;
  };

  const arm = (el: HTMLElement) => {
    if (el === target) return;
    hide();
    target = el;
    timer = window.setTimeout(() => target === el && show(el), DELAY);
  };

  const tipOf = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null);

  const onOver = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = tipOf(e);
    if (el) arm(el);
    else if (target) hide();
  };
  const onOut = (e: PointerEvent) => {
    if (target && !(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))) hide();
  };
  const onFocus = (e: FocusEvent) => {
    const el = tipOf(e);
    if (el && el.matches(':focus-visible')) arm(el);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hide();
  };

  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onOut);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);

  return () => {
    hide();
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onOut);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', hide);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
    window.removeEventListener('blur', hide);
    tip.remove();
  };
}
