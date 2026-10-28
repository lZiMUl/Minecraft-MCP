import type { IDimension } from '../interfaces/dimension.interface.js';

/** Build a tool result that reports a readable failure. */
export function toolError(message: string): {
  isError: true;
  content: [{ type: 'text'; text: string }];
} {
  return {
    isError: true,
    content: [{ type: 'text', text: message }]
  };
}

/** Return a consistent out-of-range error for a dimension. */
export function coordinateRangeError(
  dimension: IDimension,
  x: number,
  y: number,
  z: number
): ReturnType<typeof toolError> {
  return toolError(
    `Coordinates (${x}, ${y}, ${z}) are out of range in ${dimension.displayName} (Y: ${dimension.minY} to ${dimension.maxY - 1}).`
  );
}
