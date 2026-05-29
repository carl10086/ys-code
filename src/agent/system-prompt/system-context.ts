/**
 * 将 system context 追加到 system prompt 末尾
 * @param systemPrompt 原始 system prompt 数组
 * @param context 键值对 context
 * @returns 新数组（不修改原数组）
 */
export function appendSystemContext(
  systemPrompt: readonly string[],
  context: Record<string, string>,
): string[] {
  const contextText = Object.entries(context)
    .filter(([, value]) => value && value.trim() !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  if (!contextText) return [...systemPrompt];
  return [...systemPrompt, contextText];
}
