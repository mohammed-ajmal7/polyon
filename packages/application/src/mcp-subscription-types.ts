export interface McpSubscriptionFilter {
  readonly notifications?: {
    readonly toolsListChanged?: boolean;
    readonly promptsListChanged?: boolean;
    readonly resourcesListChanged?: boolean;
    readonly resourceSubscriptions?: readonly string[];
  };
}

export type McpSubscriptionNotification =
  | {
      readonly method: "notifications/tools/list_changed";
      readonly params?: Record<string, never>;
      readonly _meta?: Record<string, unknown>;
    }
  | {
      readonly method: "notifications/prompts/list_changed";
      readonly params?: Record<string, never>;
      readonly _meta?: Record<string, unknown>;
    }
  | {
      readonly method: "notifications/resources/list_changed";
      readonly params?: Record<string, never>;
      readonly _meta?: Record<string, unknown>;
    }
  | {
      readonly method: "notifications/resources/updated";
      readonly params: { readonly uri: string };
      readonly _meta?: Record<string, unknown>;
    };
