import { toErrorMessage } from '../utils/error-message.js';

/**
 * Fallback payload for a resource read that fails. Resources cannot return an
 * `isError` flag, so the failure is reported as a JSON document instead of an
 * unhandled exception.
 */
export function errorResource(
  uri: string,
  error: unknown
): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ uri, error: toErrorMessage(error) }, null, 2)
      }
    ]
  };
}
