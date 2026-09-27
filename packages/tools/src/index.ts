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
  ScopedArtifactWriteToolAdapter,
  ScopedArtifactWriteToolError,
  type ScopedArtifactWriteToolAdapterOptions,
  type ScopedArtifactWriteToolErrorKind,
  type ScopedArtifactWriteToolInput,
  type ScopedArtifactWriteToolOutput,
} from "./scoped-artifact-write-tool-adapter";

export type { ToolArtifactResult } from "./tool-adapter";

export {
  ScopedGitCommitToolAdapter,
  ScopedGitCommitToolError,
  type ScopedGitCommitToolAdapterOptions,
  type ScopedGitCommitToolErrorKind,
  type ScopedGitCommitToolInput,
  type ScopedGitCommitToolOutput,
} from "./scoped-git-commit-tool-adapter";

export {
  ScopedGitWriteToolAdapter,
  ScopedGitWriteToolError,
  type ScopedGitWriteOperation,
  type ScopedGitWriteToolAdapterOptions,
  type ScopedGitWriteToolErrorKind,
  type ScopedGitWriteToolInput,
  type ScopedGitWriteToolOutput,
} from "./scoped-git-write-tool-adapter";

export {
  ScopedGitReadToolAdapter,
  ScopedGitReadToolError,
  type ScopedGitReadOperation,
  type ScopedGitReadToolAdapterOptions,
  type ScopedGitReadToolErrorKind,
  type ScopedGitReadToolInput,
  type ScopedGitReadToolOutput,
} from "./scoped-git-read-tool-adapter";

export {
  ScopedTerminalToolAdapter,
  ScopedTerminalToolError,
  type ScopedTerminalToolAdapterOptions,
  type ScopedTerminalToolErrorKind,
  type ScopedTerminalToolInput,
  type ScopedTerminalToolOutput,
} from "./scoped-terminal-tool-adapter";

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
