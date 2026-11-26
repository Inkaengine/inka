/**
 * The blocks a block action (copy, cut) acts on: the multi-selection when
 * there is one, else the selected block.
 */
export function blockActionTargets(selectedBlock, multiSelected) {
  return multiSelected?.length > 1 ? multiSelected : [selectedBlock];
}
