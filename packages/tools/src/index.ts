export {
  InMemoryToolRegistry,
  ToolRegistryError,
  type ToolRegistry,
  type ToolRegistryErrorKind,
} from "./tool-registry";

export type { ToolAdapter, ToolInvocationRequest, ToolInvocationResult } from "./tool-adapter";

export {
  InMemoryToolAdapterRegistry,
  ToolAdapterRegistryError,
  type ToolAdapterRegistry,
  type ToolAdapterRegistryErrorKind,
} from "./tool-adapter-registry";

export {
  authorizeToolInvocation,
  ToolAuthorizationError,
  type AuthorizeToolInvocationInput,
  type ToolInvocationAuthorization,
  type ToolAuthorizationErrorKind,
} from "./tool-authorization";

export {
  ScopedFilesystemReadToolAdapter,
  FilesystemReadToolError,
  type FilesystemReadToolAdapterOptions,
  type FilesystemReadToolErrorKind,
  type FilesystemReadToolInput,
  type FilesystemReadToolOutput,
} from "./scoped-filesystem-read-adapter";

export {
  validateToolInput,
  ToolInputValidationError,
  type ToolInputValidationErrorKind,
} from "./tool-input-validation";

export {
  BUILTIN_TOOL_IDS,
  createInMemoryBuiltinToolRegistries,
  registerBuiltinTools,
  type BuiltinFilesystemReadToolRegistration,
  type BuiltinToolOptions,
  type BuiltinToolRegistries,
} from "./builtin-tools";
