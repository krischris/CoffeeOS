import {withCurrentBuild} from './current-build-browser.mjs';
import {checkSwipeRows} from './swipe-row-checks.mjs';

if (!process.env.TEST_REDUCED_MOTION) throw Error('Run motion-firefox through the harness to set the isolated motion preference');
await withCurrentBuild(checkSwipeRows);
