import mongoose from "mongoose";

export class StudyNotFoundError extends Error {
  constructor(
    readonly entity: string,
    id: string,
  ) {
    super(`${entity} ${id} not found`);
    this.name = "StudyNotFoundError";
  }
}

export class NotebookNotFoundError extends StudyNotFoundError {
  constructor(id: string) {
    super("notebook", id);
    this.name = "NotebookNotFoundError";
  }
}

export class StudyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyValidationError";
  }
}

export function toObjectId(
  id: string,
  fail: () => Error,
): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw fail();
  return new mongoose.Types.ObjectId(id);
}
