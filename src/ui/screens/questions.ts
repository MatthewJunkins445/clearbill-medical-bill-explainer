// S08: single-turn questions. Every question runs on this computer (`askQuestion` has no cloud mode), and each
// answer is its own card. The answer shows placeholders until the user asks to fill in their details.
import type { AIResult, QuestionAnswer, RedactionApproval } from '../../ai/index.ts';
import { badge } from '../badge.ts';
import type { AppContext } from '../context.ts';
import { t, tList } from '../copy.ts';
import { h } from '../dom.ts';
import { withQuestionDraft, withTab } from '../state.ts';
import { stepTitle } from '../steps.ts';
import { recoveryCard } from './errors.ts';
import { createIdSource } from './ids.ts';
import { auditReasonFor, changeChoiceButton, errorCodeOf } from './results-common.ts';

function answerCard(
  question: string,
  result: AIResult<QuestionAnswer>,
  approval: RedactionApproval,
  ctx: AppContext,
  hintId: string,
): { card: HTMLElement; heading: HTMLElement } {
  const heading = h('h3', { tabindex: '-1' }, t('questions.answerFor', { question }));
  const text = h('p', { class: 'answer-text' }, result.data.answer);
  const filled = approval.vault.rehydrate(result.data.answer);
  const fill = h('div', { class: 'actions' });
  // Only offered when there is something to fill in. Rehydration is local: nothing leaves this computer.
  if (filled !== result.data.answer) {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'aria-describedby': hintId,
        onClick: () => {
          text.textContent = filled;
          fill.replaceChildren(h('span', { class: 'muted' }, t('letter.fillDetailsOn')));
          ctx.announce(t('letter.fillDetailsOn'));
        },
      },
      t('letter.fillDetails'),
    );
    fill.append(button);
  }
  const card = h(
    'article',
    { class: 'answer-card panel' },
    heading,
    text,
    fill.childElementCount > 0 ? h('p', { class: 'muted', id: hintId }, t('letter.fillDetailsHint')) : null,
    fill.childElementCount > 0 ? fill : null,
    h('div', { class: 'actions' }, badge(result.source)),
    h('p', { class: 'muted' }, t('questions.standsAlone')),
  );
  return { card, heading };
}

export function questionsScreen(ctx: AppContext, approval: RedactionApproval): HTMLElement {
  const input = h('input', {
    type: 'text',
    id: 'question-text',
    class: 'text-input question-input',
    autocomplete: 'off',
    placeholder: t('questions.inputPlaceholder'),
    'aria-describedby': 'question-hint',
  });
  const setDraft = (text: string): void => {
    // Same step and tab: the screen is not rebuilt, so typing keeps its focus and caret.
    ctx.update((s) => withQuestionDraft(s, text));
  };
  input.value = ctx.getSession().questionDraft;
  input.addEventListener('input', () => {
    setDraft(input.value);
  });
  const nextHintId = createIdSource('fill-hint');

  const slot = h('div', { class: 'question-slot' });
  const busy = h('p', { class: 'muted', hidden: true }, t('questions.asking'));
  const history = h('ul', { class: 'answer-list' });
  const empty = h('p', { class: 'muted' }, t('questions.historyEmpty'));
  const ask = h('button', { type: 'submit', class: 'btn btn-primary' }, t('questions.ask'));
  let pending = false;

  async function submit(): Promise<void> {
    const question = input.value.trim();
    if (question === '') {
      input.focus();
      return;
    }
    if (pending) return;
    pending = true;
    ask.setAttribute('aria-disabled', 'true');
    busy.hidden = false;
    slot.replaceChildren();
    ctx.announce(t('questions.asking'));
    try {
      const result = await ctx.ai.askQuestion(approval.bill, question);
      // Logged even when the user has already left this screen: the call happened.
      ctx.record('question', result);
      if (ctx.signal.aborted) return;
      const { card, heading } = answerCard(question, result, approval, ctx, nextHintId());
      empty.hidden = true;
      history.prepend(h('li', null, card));
      setDraft('');
      input.value = '';
      heading.focus();
    } catch (error) {
      if (ctx.signal.aborted) return;
      const code = errorCodeOf(error);
      if (code === 'DEVICE_MODEL_NOT_READY')
        slot.replaceChildren(h('p', { class: 'notice' }, t('questions.deviceUnavailable')));
      slot.append(
        recoveryCard(ctx, code, () => {
          input.focus();
        }),
      );
    } finally {
      pending = false;
      ask.removeAttribute('aria-disabled');
      busy.hidden = true;
    }
  }

  const form = h(
    'form',
    { class: 'question-form', novalidate: true },
    h('label', { for: 'question-text', class: 'field-label' }, t('questions.inputLabel')),
    input,
    h('p', { class: 'muted', id: 'question-hint' }, t('questions.inputHint')),
    h('div', { class: 'actions' }, ask),
    busy,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  const suggestions = h(
    'section',
    { 'aria-labelledby': 'suggestions-title' },
    h('h2', { id: 'suggestions-title' }, t('questions.suggestionsTitle')),
    h(
      'ul',
      { class: 'chip-list' },
      ...tList('questions.suggestions').map((text) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onClick: () => {
                input.value = text;
                setDraft(text);
                input.focus();
              },
            },
            text,
          ),
        ),
      ),
    ),
  );

  const auditReason = auditReasonFor(ctx, approval.bill);

  return h(
    'section',
    { class: 'screen questions' },
    h('h1', null, stepTitle(ctx.getSession())),
    h('p', null, t('questions.intro')),
    form,
    slot,
    suggestions,
    h(
      'section',
      { 'aria-labelledby': 'history-title' },
      h('h2', { id: 'history-title' }, t('questions.historyTitle')),
      empty,
      history,
    ),
    h(
      'div',
      { class: 'actions' },
      auditReason === null
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onClick: () => {
                ctx.update((s) => withTab(s, 'audit'));
              },
            },
            t('explain.nextAudit'),
          )
        : null,
      changeChoiceButton(ctx),
    ),
    auditReason === null ? null : h('p', { class: 'muted' }, t(auditReason)),
  );
}
