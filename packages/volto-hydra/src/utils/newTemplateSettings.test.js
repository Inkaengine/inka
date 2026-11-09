/**
 * Where "Make template" saves a new template, and as what type: the folder is the
 * deployment's setting; the type is a plain Document unless the deployment names
 * another.
 */
import { newTemplateSettings } from './newTemplateSettings';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('newTemplateSettings', () => {
  it('reads the default folder and type from the environment', () => {
    process.env.RAZZLE_TEMPLATES_PATH = '/shared/blocks/';
    process.env.RAZZLE_TEMPLATE_TYPE = 'Template';
    expect(newTemplateSettings()).toEqual({
      folder: '/shared/blocks',
      type: 'Template',
    });
  });

  it('names the missing folder setting', () => {
    delete process.env.RAZZLE_TEMPLATES_PATH;
    process.env.RAZZLE_TEMPLATE_TYPE = 'Template';
    expect(() => newTemplateSettings()).toThrow(/RAZZLE_TEMPLATES_PATH/);
  });

  it('makes a new template a plain Document unless the site says otherwise', () => {
    // Simple by default: every site has Document. A site that keeps its
    // templates as a type of its own names it in RAZZLE_TEMPLATE_TYPE.
    process.env.RAZZLE_TEMPLATES_PATH = '/shared';
    delete process.env.RAZZLE_TEMPLATE_TYPE;
    expect(newTemplateSettings()).toEqual({ folder: '/shared', type: 'Document' });
  });
});
