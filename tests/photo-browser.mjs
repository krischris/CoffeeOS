import {withCurrentBuild} from './current-build-browser.mjs';
import {photoChecks} from './photo-checks.mjs';
import {checkWebPMigration} from './webp-migration-checks.mjs';

await withCurrentBuild(async context => {
  await checkWebPMigration(context);
  await photoChecks(context);
});
