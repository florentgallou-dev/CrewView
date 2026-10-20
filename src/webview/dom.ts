// Construction d'éléments DOM sans innerHTML (textes issus des transcripts).

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { style?: string };
export type Child = Node | string | false | undefined;

/** Remplace le contenu d'un élément en ignorant les enfants conditionnels absents. */
export function fill(parent: Element, children: Child[]): void {
  parent.replaceChildren(...children.filter((c): c is Node | string => c !== false && c !== undefined && c !== ''));
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { style, ...rest } = props;
  Object.assign(node, rest);
  if (style) node.setAttribute('style', style);
  node.append(...children.filter((c): c is Node | string => c !== false && c !== undefined && c !== ''));
  return node;
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return el('section', {}, el('h3', {}, title), ...children);
}
