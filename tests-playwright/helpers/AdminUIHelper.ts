/**
 * The harness's AdminUIHelper, with Inka's fixture content as its default:
 * this repo's mock API serves the test pages under /_test_data.
 */
import type { Page } from '@playwright/test';
import { AdminUIHelper as HarnessAdminUIHelper } from '@inka/testing/playwright/AdminUIHelper';
import { URLS } from '../ports';
import { TEST_DATA_PREFIX } from './test-paths';

// The preview frame, re-exported so a spec gets the admin's helpers from one
// place. It belongs to the harness: the admin hosts a CMS proxy frame as well
// as the preview, so finding the preview by id rather than by "the child frame"
// is true of every suite, not just this one.
export { previewFrame } from '@inka/testing/playwright/AdminUIHelper';

export class AdminUIHelper extends HarnessAdminUIHelper {
  constructor(page: Page, adminUrl: string = URLS.voltoSsr, contentPrefix: string = TEST_DATA_PREFIX) {
    super(page, adminUrl, contentPrefix);
  }
}
