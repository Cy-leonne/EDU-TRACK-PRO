export interface PaginationInput { page?: number; pageSize?: number; sortBy?: string; sortDir?: 'asc' | 'desc'; search?: string }

export interface PaginatedResult<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean };
}

export function buildPaginated<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { items, meta: { page, pageSize, total, totalPages, hasNext: page < totalPages } };
}

export function skipTake(input: PaginationInput): { skip: number; take: number; page: number; pageSize: number } {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 25));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function orderBy(input: PaginationInput, allowed: string[], fallback = 'createdAt'): Record<string, 'asc' | 'desc'> {
  const field = input.sortBy && allowed.includes(input.sortBy) ? input.sortBy : fallback;
  return { [field]: input.sortDir === 'desc' ? 'desc' : 'asc' };
}
