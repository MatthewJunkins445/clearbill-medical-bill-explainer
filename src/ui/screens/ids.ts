/** Makes ids that are unique within one screen, for elements repeated per card (for example `fill-hint-1`). */
export function createIdSource(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
