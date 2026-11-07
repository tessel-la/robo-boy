/** Child-process crash fixture. Input is a filesystem argument, never JavaScript source. */
import { openSessionStore } from '../session-store.mjs';

const store = await openSessionStore({ file: process.argv[2], policy: 'a'.repeat(64) });
store.save([{
  key: 'b'.repeat(64), mediaKey: 'c'.repeat(64), user: { id: 'crash-test', name: 'Alice' },
  provider: 'company', expires: Date.now() + 60000,
}]);
process.stdout.write('committed');
setInterval(() => {}, 1000);
