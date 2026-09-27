export type SecretReferenceId = string;

export type SecretReferenceKind =
  "API_KEY" | "OAUTH_ACCESS_TOKEN" | "OAUTH_REFRESH_TOKEN" | "SMTP_CREDENTIAL";

export interface SecretReference {
  readonly id: SecretReferenceId;
  readonly kind: SecretReferenceKind;
  readonly provider: string;
}
