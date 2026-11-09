// Volto's own field validation, exactly as the editor's save runs it: the
// FormValidation helper and the validators Volto registers for it.
import config from '@plone/registry';
import FormValidation from '@plone/volto/helpers/FormValidation/FormValidation';
import { registerValidators } from '@plone/volto/config/validation';

registerValidators(config);

export const validateFieldsPerFieldset = FormValidation.validateFieldsPerFieldset;
export { config };
