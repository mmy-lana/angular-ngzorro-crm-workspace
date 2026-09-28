import { FilterCriterion, SortCriterion } from '@core/models/crm.models';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/**
 * Path segments that reach the prototype chain.
 *
 * A filter criterion's `field` is data, and data here is persisted in
 * `localStorage`, restored from a session, or received over `BroadcastChannel`
 * from another browsing context. Traversing `constructor.prototype` through a
 * dotted path lets a crafted criterion read `Object.prototype` and pollute
 * lookups for every record in the store, so the traversal is refused outright
 * rather than filtered case-insensitively after the fact.
 */
const FORBIDDEN_PATH_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function isForbiddenSegment(segment: string): boolean {
  return FORBIDDEN_PATH_SEGMENTS.has(segment.toLowerCase());
}

/**
 * Reads a dotted path out of an unknown record.
 *
 * Returning `unknown` rather than `any` is the point: every consumer below has
 * to narrow before comparing, which keeps a malformed field from silently
 * coercing to a match. Any path segment that would reach the prototype chain
 * aborts the whole traversal and yields `undefined`, so a poisoned criterion
 * matches nothing rather than matching everything.
 */
function getNestedValue(source: unknown, path: string): unknown {
  if (source === null || typeof source !== 'object') {
    return undefined;
  }
  const segments = path.split('.');
  for (const segment of segments) {
    if (isForbiddenSegment(segment)) {
      return undefined;
    }
  }
  return segments.reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    // `Object.create(null)` records have no inherited members, so an own-property
    // check keeps a plain object from exposing `toString` as a sortable value.
    return Object.prototype.hasOwnProperty.call(current, segment)
      ? (current as Record<string, unknown>)[segment]
      : undefined;
  }, source);
}

/**
 * Coerces a value to something comparable.
 *
 * ISO dates become epoch numbers so `2026-01-01 < 2026-06-01` is a numeric
 * comparison rather than a lexicographic one that happens to agree. Numeric
 * strings become numbers so a stored `"500"` compares against a real `500`.
 */
function parseFilterComparable(value: unknown): number | string {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    if (ISO_DATE_PATTERN.test(value)) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    const numeric = Number(value);
    if (value.trim() !== '' && !Number.isNaN(numeric)) {
      return numeric;
    }
    return value.toLowerCase();
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value).toLowerCase();
}

/** Sort counterpart of {@link parseFilterComparable}, without numeric coercion. */
function parseSortComparable(value: unknown): number | string {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && ISO_DATE_PATTERN.test(value)) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value).toLowerCase();
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Applies a conjunctive filter chain and a multi-column sort to an array.
 *
 * Filters are ANDed: every criterion must hold. Sorts apply in array order as a
 * tie-break chain, so `[{amount, desc}, {name, asc}]` sorts by amount first and
 * uses the name only to break ties. The input array is never mutated: a sorted
 * result is a copy, and a result with neither filters nor sorts is a plain copy
 * of the input.
 *
 * Null handling is deliberate. An empty field satisfies only an `equals` against
 * an empty target, because "no stage recorded" is not "stage equals
 * Prospecting". On sort, nulls always sink to the bottom regardless of
 * direction, so an undated deal never displaces a dated one at the top.
 */
export function evaluateCriteria<T extends object>(
  items: readonly T[],
  filters: readonly FilterCriterion[],
  sorts: readonly SortCriterion[]
): T[] {
  const filtered = filters.length === 0 ? [...items] : items.filter(item => matchesAll(item, filters));

  if (sorts.length === 0) {
    return filtered;
  }
  return filtered.sort((a, b) => compare(a, b, sorts));
}

function matchesAll(item: object, filters: readonly FilterCriterion[]): boolean {
  return filters.every(criterion => matches(item, criterion));
}

function matches(item: object, criterion: FilterCriterion): boolean {
  const value = getNestedValue(item, criterion.field);
  const empty = isEmptyValue(value);

  if (criterion.operator === 'isEmpty') {
    return empty;
  }
  if (criterion.operator === 'isNotEmpty') {
    return !empty;
  }
  if (empty) {
    // An absent field only satisfies a criterion that asks for absence.
    return criterion.operator === 'equals' && isEmptyTarget(criterion.value);
  }

  switch (criterion.operator) {
    case 'equals':
      return String(value).toLowerCase() === String(criterion.value ?? '').toLowerCase();
    case 'contains':
      return String(value).toLowerCase().includes(String(criterion.value ?? '').toLowerCase());
    case 'greaterThan':
      return compareScalars(value, criterion.value, (left, right) => left > right);
    case 'lessThan':
      return compareScalars(value, criterion.value, (left, right) => left < right);
    case 'in':
      return Array.isArray(criterion.value)
        ? criterion.value.some(candidate => String(candidate).toLowerCase() === String(value).toLowerCase())
        : false;
    default:
      return true;
  }
}

function isEmptyTarget(value: FilterCriterion['value']): boolean {
  return value === null || value === undefined || value === '';
}

function compareScalars(
  value: unknown,
  target: FilterCriterion['value'],
  predicate: (left: number | string, right: number | string) => boolean
): boolean {
  const left = parseFilterComparable(value);
  const right = parseFilterComparable(target);
  if (typeof left === 'number' && typeof right === 'number') {
    return predicate(left, right);
  }
  return predicate(String(left), String(right));
}

function compare(a: object, b: object, sorts: readonly SortCriterion[]): number {
  for (const sort of sorts) {
    const left = getNestedValue(a, sort.field);
    const right = getNestedValue(b, sort.field);
    if (left === right) {
      continue;
    }

    const leftNil = left === null || left === undefined;
    const rightNil = right === null || right === undefined;

    // Nulls sink to the bottom in both directions: a descending sort should
    // surface the largest value, not the emptiest.
    if (leftNil && rightNil) {
      continue;
    }
    if (leftNil) {
      return 1;
    }
    if (rightNil) {
      return -1;
    }

    const comparableLeft = parseSortComparable(left);
    const comparableRight = parseSortComparable(right);
    const result =
      typeof comparableLeft === 'number' && typeof comparableRight === 'number'
        ? comparableLeft - comparableRight
        : String(comparableLeft).localeCompare(String(comparableRight), undefined, { numeric: true });

    if (result !== 0) {
      return result * (sort.direction === 'asc' ? 1 : -1);
    }
  }
  return 0;
}
