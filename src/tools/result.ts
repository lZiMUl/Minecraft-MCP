export function toolText(text: string): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [{ type: 'text', text }]
  };
}

export function toolError(message: string): {
  isError: true;
  content: [{ type: 'text'; text: string }];
} {
  return {
    isError: true,
    content: [{ type: 'text', text: message }]
  };
}
