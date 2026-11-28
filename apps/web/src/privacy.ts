// Import only the browser-safe notice, not the core package's audio and server utilities.
export { PRIVACY_NOTICE, hasCallConsent, type CallConsent, type ConsentWithdrawal } from '../../../packages/core/src/privacy';
export { MAX_CALL_MEDIA_RETENTION_DAYS } from '../../../packages/core/src/retention';
