import {withCurrentBuild} from './current-build-browser.mjs';
import {checkStartupFailures} from './startup-checks.mjs';
import {checkBeanManager} from './bean-manager-checks.mjs';
import {checkSwipeRows} from './swipe-row-checks.mjs';
import {checkBeanDeletion} from './bean-delete-checks.mjs';
import {checkSessionEditing} from './session-edit-checks.mjs';
import {checkSessionDeletion} from './session-delete-checks.mjs';
import {checkBeanEditing} from './bean-edit-checks.mjs';
import {checkSessionFiltering} from './session-filter-checks.mjs';
import {checkBackupUpgrade} from './backup-upgrade-checks.mjs';
import {checkReviewRemediation, checkHistoryScale, checkRuntimeWorkerFailure} from './review-remediation-checks.mjs';

await withCurrentBuild(async context => {
  await checkStartupFailures(context);
  await context.openBeans();
  await checkBeanManager({...context, screenshotPath:process.env.BEAN_SCREENSHOT_PATH});
  await checkSwipeRows(context);
  await checkBeanDeletion(context);
  await checkSessionEditing(context);
  await checkSessionDeletion(context);
  await checkBeanEditing(context);
  await checkSessionFiltering(context);
  await checkBackupUpgrade(context);
  await checkReviewRemediation(context);
  await checkHistoryScale(context);
  await checkRuntimeWorkerFailure(context);
});
