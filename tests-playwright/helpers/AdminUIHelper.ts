/**
 * The harness's AdminUIHelper, with Inka's fixture content as its default:
 * this repo's mock API serves the test pages under /_test_data.
 */
import type { Page } from '@playwright/test';
import { AdminUIHelper as HarnessAdminUIHelper } from '@inka/testing/playwright/AdminUIHelper';
import { URLS } from '../ports';
import { TEST_DATA_PREFIX } from './test-paths';

export class AdminUIHelper extends HarnessAdminUIHelper {
  constructor(page: Page, adminUrl: string = URLS.voltoSsr, contentPrefix: string = TEST_DATA_PREFIX) {
    super(page, adminUrl, contentPrefix);
  }
}
