/**
 * Sanitizes a string by escaping potentially dangerous characters
 * Prevents XSS and HTML injection attacks
 *
 * @param input - The string to sanitize
 * @returns Sanitized string with HTML entities escaped
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';

  return input
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/\\/g, '&#x5C;')
    .replace(/`/g, '&#96;');
}

/**
 * Extracts a title from a message by taking the first N characters
 * and sanitizing the result
 *
 * @param message - The full message text
 * @param maxLength - Maximum title length (default: 50)
 * @returns Sanitized, truncated title
 */
export function extractTitle(message: string, maxLength: number = 50): string {
  if (typeof message !== 'string' || !message.trim()) {
    return 'New Chat';
  }

  const sanitized = sanitizeString(message);

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  // Truncate and add ellipsis
  return sanitized.substring(0, maxLength - 3).trim() + '...';
}
