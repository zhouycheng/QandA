export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误，请稍后重试。'
}
