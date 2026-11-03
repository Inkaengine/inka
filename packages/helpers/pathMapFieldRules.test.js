/**
 * A block's schema in the path map honours its `fieldRules`, as the admin's does.
 *
 * A frontend sends its rules as a recipe (`schemaEnhancer: { fieldRules }`), not
 * a function. The admin converts recipes; the path map used to skip them, so the
 * bridge's getBlockSchema — what block sanity reads to know which fields an
 * author can see — still offered a field the rules hide. Block sanity then
 * demanded an image for a content block whose image position is "hidden".
 */
import { buildBlockPathMap } from './buildBlockPathMap.js';

const imageRules = {
  fieldRules: {
    image: { when: { imagePosition: { isNot: 'hidden' } }, else: false },
  },
};

const blocksConfig = (schemaEnhancer) => ({
  _page: {
    id: '_page',
    schema: () => ({ properties: { items: { widget: 'blocks_layout' } } }),
  },
  teaser: {
    id: 'teaser',
    blockSchema: {
      fieldsets: [{ id: 'default', title: 'Default', fields: ['image', 'imagePosition'] }],
      properties: {
        image: { title: 'Image', widget: 'image' },
        imagePosition: { title: 'Image position', type: 'string' },
      },
    },
    schemaEnhancer,
  },
});

const visibleFields = (schemaEnhancer, block) => {
  const pathMap = buildBlockPathMap(
    { blocks: { t: { '@type': 'teaser', ...block } }, blocks_layout: { items: ['t'] } },
    blocksConfig(schemaEnhancer),
  );
  const schema = pathMap._schemas[pathMap.t._schemaRef];
  return schema.fieldsets.flatMap((fs) => fs.fields);
};

describe('the path map applies fieldRules recipes', () => {
  test('a field its rules hide is not offered', () => {
    expect(visibleFields(imageRules, { imagePosition: 'hidden', image: '/x.png' })).toEqual([
      'imagePosition',
    ]);
  });

  test('a field its rules show is offered', () => {
    expect(visibleFields(imageRules, { imagePosition: 'above', image: '/x.png' })).toEqual([
      'image',
      'imagePosition',
    ]);
  });

  test('rules chained after the admin\'s enhancer (mergeFrontendBlock) apply too', () => {
    const adminEnhancer = ({ schema }) => schema;
    expect(
      visibleFields([adminEnhancer, imageRules], { imagePosition: 'hidden', image: '/x.png' }),
    ).toEqual(['imagePosition']);
  });
});
