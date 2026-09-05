import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.cwd(), 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const app = initializeApp({ credential: applicationDefault(), projectId: 'trlka-b5d34' });
try {
  // validate_only: no topic subscription and no notification is delivered.
  await getMessaging(app).send(
    {
      topic: 'trlka-access-check',
      data: { check: 'server-permission-validation' },
    },
    true,
  );
  console.log(
    'FCM_DRY_RUN_OK: credentials and messaging permission accepted; no delivery performed',
  );
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code ?? 'unknown', message: error.message }));
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
