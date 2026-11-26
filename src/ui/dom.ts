// Tiny DOM helpers. No framework and no innerHTML: text always goes in through text nodes.
export type AttrValue = string | number | boolean | null | undefined | ((event: Event) => void);
export type Attrs = Readonly<Record<string, AttrValue>>;
export type Child = Node | string | number | null | undefined | false;

function apply(el: Element, attrs: Attrs | null | undefined): void {
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') {
      el.addEventListener(name.replace(/^on/, '').toLowerCase(), value);
    } else if (name === 'class') {
      el.setAttribute('class', String(value));
    } else {
      el.setAttribute(name, value === true ? '' : String(value));
    }
  }
}

function append(el: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Creates an element. `onClick`-style attributes add listeners; `true` sets a boolean attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

/** Creates an SVG element (used for the small decorative icons). */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(el, attrs);
  append(el, children);
  return el;
}
