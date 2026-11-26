// S05a / S05b: the user decides here what may leave the computer. Layout and keys follow
// design/accessibility.md section 2. The screen repaints its own list, preview and summary after
// every review change, because `ctx.update()` does not re-render a screen on a same-step change.
import {
  PII_CATEGORIES,
  type RedactionApproval,
  type RedactionDraft,
  type RedactionEntity,
  type ResultSource,
} from '../../ai/index.ts';
import { badge } from '../badge.ts';
import type { AppContext, Screen } from '../context.ts';
import { t, tn } from '../copy.ts';
import { h } from '../dom.ts';
import {
  addedEntities,
  afterRemovalEntities,
  countMatches,
  placeholderMap,
  segmentPreview,
  type PreviewSegment,
} from '../highlight.ts';
import { attachRoving } from '../roving.ts';
import {
  addDetail,
  goTo,
  removeDetail,
  setConsent,
  toggleKept,
  withApproval,
  withoutInput,
  type Session,
} from '../state.ts';
import { stepTitle } from '../steps.ts';
import { categoryLabel as label, spoken, toggleAnnouncement } from './review-announce.ts';

interface View {
  /** Entities found by the draft, then the ones the user added. */
  readonly entities: readonly RedactionEntity[];
  readonly approval: RedactionApproval;
  /** The label each replaced entity got (for example "[PATIENT_NAME_1]"). */
  readonly placeholders: ReadonlyMap<string, string>;
  /** Labels as if everything were removed: stable names for the toggle buttons whatever the user keeps. */
  readonly names: ReadonlyMap<string, string>;
}

const keyOf = (el: Element | null | undefined): string | null => el?.getAttribute('data-key') ?? null;
const groupOf = (el: Element | null | undefined): string | null => el?.getAttribute('data-group') ?? null;
const isAdded = (entity: RedactionEntity): boolean => entity.id.startsWith('added:');

function highlight(
  seg: PreviewSegment,
  entity: RedactionEntity,
  placeholder: string,
  visible: string,
): HTMLElement {
  const category = label(entity.category);
  const guarded = seg.kept && entity.locked;
  const kept = seg.kept && !entity.locked;
  const kind = guarded
    ? 'guarded'
    : kept
      ? 'kept'
      : isAdded(entity)
        ? 'manual'
        : entity.locked
          ? 'locked'
          : 'removed';
  const words = spoken(placeholder);
  const sr = guarded
    ? t('highlight.srKeptButGuarded', { category, placeholder: words })
    : kept
      ? t('highlight.srKept', { category, original: entity.value })
      : isAdded(entity)
        ? t('highlight.srManual', { category, placeholder: words })
        : t(entity.locked ? 'highlight.srRemovedLocked' : 'highlight.srRemoved', {
            category,
            placeholder: words,
          });
  return h(
    'span',
    { class: `hl hl-${kind}`, 'data-entity': entity.id },
    h('span', { 'aria-hidden': 'true' }, visible),
    h('span', { class: 'sr-only' }, sr),
  );
}

function missingDraft(ctx: AppContext): HTMLElement {
  return h(
    'section',
    { class: 'screen' },
    h('h1', null, stepTitle(ctx.getSession())),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary',
          onClick: () => {
            ctx.update(withoutInput);
          },
        },
        t('review.backToImport'),
      ),
    ),
  );
}

function buildReview(ctx: AppContext, draft: RedactionDraft, draftSource: ResultSource | null): HTMLElement {
  const rulesOnly = draftSource === 'LOCAL_RULES';

  let view: View | null = null;
  let showOriginal = false;
  let activeKey: string | null = null;
  let pendingFocus: string | null = null;

  const summary = h('p', { class: 'summary' });
  const groups = h('div', { class: 'detail-groups' });
  const region = h('div', {
    class: 'preview-text',
    id: 'preview-region',
    role: 'region',
    tabindex: 0,
  });
  const guardApplied = h('p', { class: 'notice', hidden: true });
  // Constant name ("Show original"); aria-pressed carries which text is shown.
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'aria-pressed': 'false',
      'aria-controls': 'preview-region',
      onClick: () => {
        showOriginal = !showOriginal;
        paint();
      },
    },
    t('review.showOriginal'),
  );

  const compute = (s: Session): View | null => {
    const entities = [...draft.entities, ...addedEntities(draft.text, s.added)];
    try {
      // The mock adapter records the last approval it returned (and cloud availability checks that one), so
      // these preview results are never stored in the session: "Looks right, continue" approves again.
      const approval = ctx.ai.approveRedaction(draft, {
        added: s.added,
        removedIds: s.keptIds,
        consentToCloud: false,
      });
      const all = ctx.ai.approveRedaction(draft, { added: s.added, removedIds: [], consentToCloud: false });
      return {
        entities,
        approval,
        placeholders: placeholderMap(entities, approval.applied),
        names: placeholderMap(entities, all.applied),
      };
    } catch {
      ctx.showError('UNKNOWN');
      return null;
    }
  };

  const rowButtons = (): HTMLButtonElement[] => [
    ...groups.querySelectorAll<HTMLButtonElement>('button[data-key]'),
  ];
  const setActive = (key: string | null): void => {
    const buttons = rowButtons();
    activeKey = buttons.some((b) => keyOf(b) === key) ? key : keyOf(buttons[0]);
    for (const b of buttons) b.tabIndex = keyOf(b) === activeKey ? 0 : -1;
  };

  function toggleRow(entity: RedactionEntity): void {
    const before = view;
    const id = entity.id;
    ctx.update((s) => toggleKept(s, id));
    ctx.announce(
      toggleAnnouncement({
        nowKept: ctx.getSession().keptIds.includes(id),
        locked: entity.locked,
        category: entity.category,
        original: entity.value,
        placeholderBefore: before?.placeholders.get(id) ?? view?.names.get(id),
        placeholderAfter: view?.placeholders.get(id),
      }),
    );
  }

  function undoAdded(entity: RedactionEntity): void {
    ctx.update((s) => removeDetail(s, Number(entity.id.slice('added:'.length))));
    ctx.announce(t('review.undoAddAnnounce', { original: entity.value }));
  }

  function row(entity: RedactionEntity, group: string, s: Session, v: View): HTMLElement {
    const placeholder = v.placeholders.get(entity.id);
    const added = isAdded(entity);
    const kept = s.keptIds.includes(entity.id);
    const shown = placeholder ?? entity.value;
    let button: HTMLButtonElement;
    if (added) {
      button = h(
        'button',
        {
          type: 'button',
          class: 'btn toggle',
          'data-key': entity.id,
          'data-group': group,
          'aria-label': t('review.undoAddLabel', {
            original: entity.value,
            category: label(entity.category),
          }),
          onClick: () => {
            undoAdded(entity);
          },
        },
        t('review.undoAdd'),
      );
    } else {
      button = h(
        'button',
        {
          type: 'button',
          class: 'btn toggle',
          'data-key': entity.id,
          'data-group': group,
          'aria-pressed': String(!kept),
          // Deliberate deviation from design/accessibility.md (name flips between Remove and Keep): a constant
          // name with aria-pressed carrying the state follows the ARIA authoring practices for toggle buttons.
          'aria-label': `${t('review.toggleRemove')} ${label(entity.category)}: ${spoken(
            v.names.get(entity.id) ?? entity.value,
          )}`,
          'aria-describedby': entity.locked ? 'guard-notice' : null,
          onClick: () => {
            toggleRow(entity);
          },
        },
        t('review.toggleRemove'),
      );
    }
    return h(
      'li',
      { class: `detail-row${kept ? ' is-kept' : ''}` },
      h('span', { class: 'detail-category' }, label(entity.category)),
      h('span', { class: 'detail-value' }, shown),
      h(
        'span',
        { class: 'detail-status' },
        added ? t('review.manualTag') : t(kept && !entity.locked ? 'review.itemKept' : 'review.itemRemoved'),
      ),
      entity.locked
        ? h('span', { class: 'tag', title: t('review.lockedTooltip') }, t('review.lockedTag'))
        : null,
      button,
    );
  }

  function paintList(s: Session, v: View): void {
    const grouped = PII_CATEGORIES.map((category) => ({
      category,
      items: v.entities.filter((entity) => entity.category === category),
    })).filter((g) => g.items.length > 0);
    groups.replaceChildren(
      ...grouped.map(({ category, items }) =>
        h(
          'section',
          { class: 'detail-group', 'aria-labelledby': `group-${category}` },
          h(
            'h3',
            { id: `group-${category}` },
            t('review.groupCount', { category: label(category), count: items.length }),
          ),
          h('ul', { class: 'detail-list' }, ...items.map((entity) => row(entity, category, s, v))),
        ),
      ),
    );
  }

  function paintPreview(s: Session, v: View): void {
    const { approval } = v;
    const entities = showOriginal
      ? v.entities
      : afterRemovalEntities(draft.text, v.entities, s.keptIds, approval.applied);
    const text = showOriginal ? draft.text : approval.bill.redactedText;
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    region.setAttribute('aria-label', t('highlight.previewRegionLabel', { count: approval.applied.length }));
    region.replaceChildren(
      ...segmentPreview(text, entities, s.keptIds).map((seg) => {
        const entity = seg.entityId === null ? undefined : byId.get(seg.entityId);
        if (!entity) return seg.text;
        const placeholder = showOriginal ? (v.placeholders.get(entity.id) ?? '') : seg.text;
        return highlight(seg, entity, placeholder, seg.text);
      }),
    );
    toggle.setAttribute('aria-pressed', String(showOriginal));
  }

  function paint(): void {
    const s = ctx.getSession();
    const next = compute(s);
    if (!next) return;
    view = next;
    const focused = document.activeElement;
    const oldKeys = rowButtons().map(keyOf);
    const focusKey =
      pendingFocus ?? (focused instanceof HTMLElement && groups.contains(focused) ? keyOf(focused) : null);
    const oldIndex = oldKeys.indexOf(focusKey);
    pendingFocus = null;

    const removedCount = next.entities.filter((entity) => next.placeholders.has(entity.id)).length;
    summary.textContent =
      next.entities.length === 0 ? t('review.summaryNone') : tn('review.summary', removedCount);
    paintList(s, next);
    paintPreview(s, next);
    const guardCount = next.approval.guardAppliedCount;
    guardApplied.hidden = guardCount === 0;
    guardApplied.textContent = guardCount > 0 ? tn('review.guardAppliedNotice', guardCount) : '';

    const buttons = rowButtons();
    const target =
      buttons.find((b) => keyOf(b) === focusKey) ??
      (focusKey !== null && oldIndex >= 0 ? buttons[Math.min(oldIndex, buttons.length - 1)] : undefined);
    setActive(keyOf(target) ?? activeKey);
    if (focusKey !== null) (target ?? addInput).focus();
  }

  attachRoving(groups, rowButtons, groupOf);
  // Moving through the list outlines and scrolls the matching words in the preview (the highlights are not tab stops).
  groups.addEventListener('focusin', (event) => {
    const key = event.target instanceof HTMLElement ? keyOf(event.target) : null;
    if (key === null) return;
    setActive(key);
    for (const el of region.querySelectorAll('.hl-active')) el.classList.remove('hl-active');
    const marks = region.querySelectorAll<HTMLElement>(`[data-entity="${CSS.escape(key)}"]`);
    for (const el of marks) el.classList.add('hl-active');
    // Scroll only the preview box: scrollIntoView would also move the page and shift the row under a mouse click.
    const mark = marks[0]?.getBoundingClientRect();
    const box = region.getBoundingClientRect();
    if (mark && mark.top < box.top) region.scrollTop -= box.top - mark.top;
    else if (mark && mark.bottom > box.bottom) region.scrollTop += mark.bottom - box.bottom;
  });

  // Add a detail we missed
  const addInput = h('input', { type: 'text', id: 'add-text', class: 'text-input', autocomplete: 'off' });
  const addError = h('p', { id: 'add-error', class: 'field-error', hidden: true });
  const addCategory = h(
    'select',
    { id: 'add-category', class: 'text-input' },
    ...PII_CATEGORIES.map((category) => h('option', { value: category }, label(category))),
  );
  addCategory.value = 'PERSON_NAME';
  const clearAddError = (): void => {
    addInput.removeAttribute('aria-invalid');
    addInput.removeAttribute('aria-describedby');
    addError.hidden = true;
    addError.textContent = '';
  };
  addInput.addEventListener('input', clearAddError);
  const submitAdd = (): void => {
    const value = addInput.value.trim();
    if (value === '') {
      addInput.focus();
      return;
    }
    const matches = countMatches(draft.text, value);
    if (matches === 0) {
      const message = t('review.addNoMatch', { text: value });
      addInput.setAttribute('aria-invalid', 'true');
      addInput.setAttribute('aria-describedby', 'add-error');
      addError.textContent = message;
      addError.hidden = false;
      ctx.announce(message);
      addInput.focus();
      return;
    }
    clearAddError();
    const category = PII_CATEGORIES.find((c) => c === addCategory.value) ?? 'PERSON_NAME';
    const existing = ctx.getSession().added.findIndex((a) => a.category === category && a.value === value);
    const index = existing >= 0 ? existing : ctx.getSession().added.length;
    pendingFocus = `added:${String(index)}`;
    if (existing < 0) ctx.update((s) => addDetail(s, { category, value }));
    else paint();
    ctx.announce(tn('review.addedAnnounce', matches, { category: label(category) }));
    addInput.value = '';
  };
  const form = h(
    'form',
    {
      class: `add-form panel${rulesOnly ? ' emphasis' : ''}`,
      'aria-labelledby': 'add-title',
      novalidate: true,
    },
    h('h2', { id: 'add-title' }, t('review.addTitle')),
    h('p', { class: 'muted' }, t('review.addHint')),
    h('label', { for: 'add-text', class: 'field-label' }, t('review.addTextLabel')),
    addInput,
    addError,
    h('label', { for: 'add-category', class: 'field-label' }, t('review.addCategoryLabel')),
    addCategory,
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn' }, t('review.addButton'))),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAdd();
  });
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    addInput.value = '';
    clearAddError();
  });

  const proceed = (): void => {
    const s = ctx.getSession();
    try {
      const approval = ctx.ai.approveRedaction(draft, {
        added: s.added,
        removedIds: s.keptIds,
        consentToCloud: false,
      });
      // setConsent first: it drops any approval, withApproval then stores the fresh one.
      ctx.update((x) => goTo(withApproval(setConsent(x, 'notAsked'), approval), 'consent'));
    } catch {
      ctx.showError('UNKNOWN', proceed);
    }
  };

  const legend = h(
    'ul',
    { class: 'legend' },
    h(
      'li',
      null,
      h('span', { class: 'hl hl-removed', 'aria-hidden': 'true' }, '[ ]'),
      ' ',
      t('highlight.visibleLegendRemoved'),
    ),
    h(
      'li',
      null,
      h('span', { class: 'hl hl-kept', 'aria-hidden': 'true' }, 'abc'),
      ' ',
      t('highlight.visibleLegendKept'),
    ),
    h(
      'li',
      null,
      h('span', { class: 'hl hl-locked', 'aria-hidden': 'true' }, '[ ]'),
      ' ',
      t('highlight.visibleLegendLocked'),
    ),
  );

  const dom = h(
    'section',
    { class: 'screen review' },
    h(
      'div',
      { class: 'heading-row' },
      h('h1', null, stepTitle(ctx.getSession())),
      draftSource ? badge(draftSource) : null,
    ),
    h('p', null, t('review.intro')),
    summary,
    rulesOnly
      ? h(
          'section',
          { class: 'notice', role: 'note' },
          h('h2', null, t('specialStates.rulesOnly.bannerTitle')),
          h('p', null, t('specialStates.rulesOnly.bannerBody')),
        )
      : null,
    h(
      'section',
      { class: 'notice', role: 'note', id: 'guard-notice' },
      h('h2', null, t('review.guardTitle')),
      h('p', null, t('review.guardBody')),
      badge('LOCAL_RULES'),
    ),
    h(
      'div',
      { class: 'review-grid' },
      h('div', { class: 'area-toggle' }, toggle),
      h(
        'section',
        { class: 'area-list', 'aria-labelledby': 'list-title' },
        h('h2', { id: 'list-title' }, t('review.listTitle')),
        h('p', { class: 'muted' }, t('review.listHint')),
        groups,
      ),
      h('div', { class: 'area-form' }, form),
      h(
        'section',
        { class: 'area-preview', 'aria-labelledby': 'preview-title' },
        h('h2', { id: 'preview-title' }, t('review.previewTitle')),
        h('p', { class: 'muted' }, t('review.previewHint')),
        rulesOnly ? h('p', { class: 'muted' }, t('specialStates.rulesOnly.reviewNudge')) : null,
        legend,
        region,
        guardApplied,
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => {
            ctx.update(withoutInput);
          },
        },
        t('review.backToImport'),
      ),
      h('button', { type: 'button', class: 'btn btn-primary', onClick: proceed }, t('review.continue')),
    ),
  );

  paint();
  // Visiting Review invalidates any earlier approval and consent (they were made for a review that may now change).
  const entered = ctx.getSession();
  if (entered.approval !== null || entered.consent !== 'notAsked')
    ctx.update((s) => setConsent(s, 'notAsked'));
  ctx.subscribe(paint);
  return dom;
}

export const reviewScreen: Screen = (ctx) => {
  const { draft, draftSource } = ctx.getSession();
  return draft ? buildReview(ctx, draft, draftSource) : missingDraft(ctx);
};
