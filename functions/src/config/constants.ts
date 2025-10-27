/**
 * Functions: Global constants
 * Keep environment-agnostic constants here. Prefer reading overrides from process.env in call sites.
 */

/** Default prod partner caller service account (override via PARTNER_CALLER_SA). */
export const DEFAULT_PARTNER_CALLER_SA = 'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com';

/** OAuth scope needed to call IAM Credentials API. */
export const OAUTH_CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Base URL for IAM Credentials API. */
export const IAM_CREDENTIALS_BASE_URL = 'https://iamcredentials.googleapis.com/v1';

/** Static resource path segment for IAM Service Accounts. */
export const IAM_SERVICE_ACCOUNTS_PATH = 'projects/-/serviceAccounts';

/** IAM Credentials RPC method names. */
export enum IamCredentialsMethod {
  GENERATE_ID_TOKEN = 'generateIdToken',
}
