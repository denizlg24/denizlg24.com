import { ValidationError } from "../errors";

interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export function pagination(
  options: PaginationOptions,
  defaults: { limit: number },
): Pagination {
  const page = options.page ?? 1;
  const limit = options.limit ?? defaults.limit;

  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError(
      "page must be a positive integer",
      "INVALID_PAGE",
    );
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError(
      "limit must be a positive integer",
      "INVALID_LIMIT",
    );
  }

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}
