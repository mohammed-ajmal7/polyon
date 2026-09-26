export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type ActionKind =
  | "READ"
  | "WRITE"
  | "DELETE"
  | "TERMINAL"
  | "NETWORK"
  | "GIT"
  | "DEPLOY"
  | "EXTERNAL_COMMUNICATION"
  | "PUBLISH"
  | "OTHER";
