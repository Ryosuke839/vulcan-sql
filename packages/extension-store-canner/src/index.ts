// suppress the warning message from aws-sdk: Please migrate your code to use AWS SDK for JavaScript (v3).
// since in aws-sdk, they only check if AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE exists, but not the value
// setting it to a string value of 1 should work
process.env['AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE'] = '1';

export * from './lib/cannerPersistenceStore';
import { CannerPersistenceStore } from './lib/cannerPersistenceStore';
export default [CannerPersistenceStore];
