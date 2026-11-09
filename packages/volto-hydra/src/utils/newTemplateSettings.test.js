/**
 * Where "Make template" saves a new template, and as what type: both come from the
 * deployment's settings, never from a folder or type written into Inka.
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

  it('names the missing type setting', () => {
    process.env.RAZZLE_TEMPLATES_PATH = '/shared';
    delete process.env.RAZZLE_TEMPLATE_TYPE;
    expect(() => newTemplateSettings()).toThrow(/RAZZLE_TEMPLATE_TYPE/);
  });
});
