const FALLBACK_MESSAGE = 'Unknown error';

/**
 * Convert any thrown value into a human-readable, non-empty message.
 * This function never throws: unserializable values fall back to a constant.
 */
export function toErrorMessage(error: unknown): string {
  if (error === null || error === void 0) {
    return FALLBACK_MESSAGE;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : error.name || FALLBACK_MESSAGE;
  }

  if (typeof error === 'string') {
    return error.trim() || FALLBACK_MESSAGE;
  }

  if (typeof error === 'object') {
    try {
      const serialized = JSON.stringify(error);
      return typeof serialized === 'string' && serialized !== '{}'
        ? serialized
        : FALLBACK_MESSAGE;
    } catch {
      return FALLBACK_MESSAGE;
    }
  }

  return String(error) || FALLBACK_MESSAGE;
}
