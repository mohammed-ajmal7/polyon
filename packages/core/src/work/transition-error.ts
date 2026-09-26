export class InvalidStateTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
    this.from = from;
    this.to = to;
  }
}
