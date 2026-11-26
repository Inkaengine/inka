/**
 * What each registered slate toolbar button is: a block format (it goes in the
 * format dropdown) or not, and the element type it applies (`format`, or
 * undefined for one that names none, such as the link editor or style menu).
 *
 * Found by calling each button with no props and reading the element it
 * returns: factories return <BlockButton format=…/> or <MarkElementButton
 * format=…/>. Some buttons are components with hooks instead (volto-slate's
 * link button); called during the toolbar's render, their hooks run as the
 * toolbar's own. So EVERY registered button is called, in the registry's
 * order, never only the ones listed or allowed: the toolbar is one component
 * that redraws as the author moves between blocks whose regions allow
 * different styles, and a different set of calls would change its hook count
 * and crash it (inka#485, #640). The registry is fixed once the config has
 * loaded (a frontend can't send functions), so the calls are the same on every
 * render. A button that throws when called this way names no format.
 */
export function probeToolbarButtons(buttons, BlockButtonRef) {
  const kinds = {};
  for (const [name, Btn] of Object.entries(buttons)) {
    let element;
    try {
      element = Btn({});
    } catch (e) {
      element = undefined;
    }
    kinds[name] = { block: element?.type === BlockButtonRef, format: element?.props?.format };
  }
  return kinds;
}
