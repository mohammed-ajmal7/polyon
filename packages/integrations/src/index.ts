export {
  SmtpTransport,
  SmtpAuthenticationError,
  SmtpEnvelopeError,
  SmtpDeliveryError,
  SmtpTransportError,
  type SmtpConnection,
  type SmtpConnectionFactory,
  type SmtpEmailTransportOptions,
} from "./smtp-email-transport";

export {
  validateSmtpTransportOptions,
  type SmtpAuthMechanism,
  type SmtpTransportOptions,
  type ValidatedSmtpTransportOptions,
} from "./smtp-transport";

export {
  EmailIntegrationAdapter,
  EmailIntegrationAdapterError,
  type EmailIntegrationAdapterErrorKind,
  type EmailIntegrationAdapterOptions,
  type EmailOperation,
  type EmailSendInput,
  type EmailSendOutput,
  type EmailTransport,
} from "./email-integration-adapter";

export {
  TelegramIntegrationAdapter,
  TelegramIntegrationAdapterError,
  type TelegramIntegrationAdapterErrorKind,
  type TelegramIntegrationAdapterOptions,
  type TelegramOperation,
  type TelegramParseMode,
  type TelegramSendMessageInput,
  type TelegramSendMessageOutput,
} from "./telegram-integration-adapter";

export {
  GoogleDriveIntegrationAdapter,
  GoogleDriveIntegrationAdapterError,
  type GoogleDriveFileMetadata,
  type GoogleDriveGetMetadataInput,
  type GoogleDriveIntegrationAdapterErrorKind,
  type GoogleDriveIntegrationAdapterOptions,
  type GoogleDriveInvocationInput,
  type GoogleDriveInvocationOutput,
  type GoogleDriveListInput,
  type GoogleDriveListOutput,
  type GoogleDriveMetadataOutput,
  type GoogleDriveOperation,
} from "./google-drive-integration-adapter";

export {
  EnvironmentSecretResolver,
  SecretResolverError,
  type EnvironmentSecretResolverOptions,
  type SecretResolver,
  type SecretResolverErrorKind,
} from "./secret-resolver";

export {
  BoundedHttpClient,
  BoundedHttpClientError,
  type BoundedHttpClientErrorKind,
  type BoundedHttpClientOptions,
  type BoundedHttpRequest,
  type BoundedHttpResponse,
} from "./bounded-http-client";

export type {
  IntegrationAdapter,
  IntegrationId,
  IntegrationInvocationRequest,
  IntegrationInvocationResult,
  IntegrationKind,
} from "./integration-adapter";

export {
  InMemoryIntegrationAdapterRegistry,
  IntegrationAdapterRegistryError,
  type IntegrationAdapterRegistry,
  type IntegrationAdapterRegistryErrorKind,
} from "./integration-adapter-registry";

export {
  authorizeIntegrationInvocation,
  IntegrationAuthorizationError,
  type AuthorizeIntegrationInvocationInput,
  type IntegrationInvocationAuthorization,
  type IntegrationAuthorizationErrorKind,
} from "./integration-authorization";
