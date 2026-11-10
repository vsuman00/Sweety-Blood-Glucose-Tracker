export function pagination(query) {
  function integer(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
    if (value === undefined) return fallback;
    if (
      typeof value !== "string" ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1 ||
      Number(value) > maximum
    )
      throw Object.assign(
        new Error(
          "Page must be a positive integer and limit must be between 1 and 100.",
        ),
        { status: 400, code: "VALIDATION" },
      );
    return Number(value);
  }
  const page = integer(query.page, 1),
    limit = integer(query.limit, 20, 100);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset))
    throw Object.assign(new Error("Page offset is too large."), {
      status: 400,
      code: "VALIDATION",
    });
  return { page, limit, offset };
}

export const pageInfo = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
