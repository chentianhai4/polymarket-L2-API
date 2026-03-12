function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableError(error) {
  if (!error) return false;
  const status = error.status ?? error.response?.status;
  if (status && status >= 500) return true;
  const code = error.code ?? "";
  if (["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH"].includes(code)) return true;
  return false;
}

export async function retryWithBackoff(fn, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 250,
    factor = 2,
    maxDelayMs = 5000,
    shouldRetry = isRetryableError,
  } = options;

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }

      const delay = Math.min(maxDelayMs, baseDelayMs * factor ** attempt);
      await sleep(delay);
      attempt += 1;
    }
  }

  throw lastError;
}
