import type { JobId } from "@polyon/contracts";

export class JobQueue {
  private readonly ids: JobId[] = [];
  private readonly queued = new Set<JobId>();

  enqueue(id: JobId): void {
    if (this.queued.has(id)) return;
    this.ids.push(id);
    this.queued.add(id);
  }

  has(id: JobId): boolean {
    return this.queued.has(id);
  }

  peek(): JobId | undefined {
    return this.ids[0];
  }

  dequeue(): JobId | undefined {
    const id = this.ids.shift();
    if (id === undefined) return undefined;
    this.queued.delete(id);
    return id;
  }

  remove(id: JobId): boolean {
    if (!this.queued.has(id)) return false;
    const index = this.ids.indexOf(id);
    if (index >= 0) this.ids.splice(index, 1);
    this.queued.delete(id);
    return index >= 0;
  }

  size(): number {
    return this.ids.length;
  }
}
