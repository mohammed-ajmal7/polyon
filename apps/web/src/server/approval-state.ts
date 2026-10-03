import type { ApprovalRequest } from "@polyon/contracts";
export interface ApprovalCheckpoint { readonly approval: ApprovalRequest; }
export async function persistApprovalCheckpoint(): Promise<void> {}
export async function getApprovalCheckpoint(): Promise<ApprovalCheckpoint | undefined> { return undefined; }
export async function listPendingApprovalCheckpoints(): Promise<ApprovalCheckpoint[]> { return []; }
