/**
 * Where to click to SELECT a block: which of its elements, and where on it.
 *
 * A block can be several elements sharing one `data-block-uid`, and the first
 * in the DOM is not necessarily one an author would click — its centre can be a
 * link, which a click follows instead of selecting anything. So look over each
 * of the block's elements (scrolled into view, so the browser can say what is
 * under a point) for a spot that is not on something INSIDE the element that
 * acts when clicked:
 *
 * - a link the editor lets navigate (`data-linkable-allow`) — ordinary links
 *   need no skipping, the editor stops them;
 * - a reveal handle (`data-block-selector`), which shows rather than selects;
 * - a button or form control, which runs the page's own script.
 *
 * The element itself may be any of those (a block that IS a link), and a nested
 * block under the spot is fine — the caller selects the parent from a child.
 * Candidate spots run from the centre outwards, so a block whose centre is fine
 * is clicked where it always was. With nowhere better, it is still clicked: the
 * centre of its first element with a box, exactly as before. Null only when the
 * block has no element with a box at all.
 *
 * SELF-CONTAINED: passed to Playwright's `locator.evaluate` and run in the page,
 * so it may not reference anything outside its own body. `anchor` is any element
 * in the block's document — the iframe's — which is where it looks.
 */
export function selectablePoint(
  anchor: Element,
  uid: string,
): { index: number; x: number; y: number; clientX: number; clientY: number } | null {
  const doc = anchor.ownerDocument;
  const ACTS = '[data-linkable-allow], [data-block-selector], button, input, select, textarea';
  const FRACTIONS = [0.5, 0.25, 0.75, 0.1, 0.9];
  const elements = Array.from(doc.querySelectorAll(`[data-block-uid="${uid}"]`));
  let first: { index: number; x: number; y: number; clientX: number; clientY: number } | null =
    null;
  for (let index = 0; index < elements.length; index += 1) {
    const el = elements[index];
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (!first) {
      first = {
        index,
        x: box.width / 2,
        y: box.height / 2,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      };
    }
    for (const fy of FRACTIONS) {
      for (const fx of FRACTIONS) {
        const x = box.width * fx;
        const y = box.height * fy;
        const clientX = box.left + x;
        const clientY = box.top + y;
        const hit = doc.elementFromPoint(clientX, clientY);
        if (!hit || !el.contains(hit)) continue;
        const acts = hit.closest(ACTS);
        if (acts && acts !== el && el.contains(acts)) continue;
        return { index, x, y, clientX, clientY };
      }
    }
  }
  if (first) elements[first.index].scrollIntoView({ block: 'center', inline: 'center' });
  return first;
}
