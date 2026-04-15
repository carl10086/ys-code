import { buildSystemPrompt } from '../src/services/system-prompt/system-prompt'
import { buildEffectiveSystemPrompt } from '../src/services/system-prompt/effective-prompt'
import { prependUserContext } from '../src/utils/messages'

async function main() {
  // 1. 构建纯静态 system prompt（不再包含任何上下文）
  const systemPrompt = await buildSystemPrompt()

  // 2. 模拟 systemContext（由调用层获取，如 getSystemContext）
  const systemContext = {
    gitStatus: 'Current branch: main\nStatus: clean',
  }

  // 3. 模拟 userContext（由调用层获取，如 getUserContext）
  const userContext = {
    currentDate: "Today's date is 2026/04/14.",
    claudeMd: '# CLAUDE.md\n\nThis is a test project.',
  }

  // 4. systemContext 追加到 system prompt 末尾（对应 cc 的 appendSystemContext）
  const fullSystemPrompt = buildEffectiveSystemPrompt(systemPrompt, systemContext)

  // 5. userContext 包装为 meta user message 插入 messages 开头（对应 cc 的 prependUserContext）
  const messages = prependUserContext([], userContext)

  console.log('=== BASE SYSTEM PROMPT ===')
  systemPrompt.forEach((layer, i) => {
    console.log(`\n--- LAYER ${i} ---`)
    console.log(layer)
  })

  console.log('\n=== SYSTEM PROMPT WITH SYSTEM CONTEXT ===')
  fullSystemPrompt.forEach((layer, i) => {
    console.log(`\n--- LAYER ${i} ---`)
    console.log(layer)
  })

  console.log('\n=== MESSAGES WITH USER CONTEXT ===')
  messages.forEach((msg, i) => {
    if (msg.type === 'user') {
      console.log(`\n--- MESSAGE ${i} (isMeta: ${msg.isMeta}) ---`)
      console.log(msg.message.content)
    }
  })
}

main().catch(console.error)
