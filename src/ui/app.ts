// Placeholder shell so the skeleton builds. frontend replaces this in a later work item.
export function mountApp(root: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'ClearBill';
  const note = document.createElement('p');
  note.textContent = 'Medical bill explainer. Work in progress.';
  root.replaceChildren(heading, note);
}
