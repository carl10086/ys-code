// src/skills/frontmatter.ts
import { parse as parseYaml } from 'yaml'

/** Frontmatter 数据结构 */
export interface FrontmatterData {
  /** Skill 名称 */
  name?: string
  /** Skill 描述 */
  description?: string | null
  /** 上下文模式: inline(内联) 或 fork(分支) */
  context?: 'inline' | 'fork' | null
  /** 使用的 Agent 名称 */
  agent?: string | null
  /** 允许使用的工具列表 */
  'allowed-tools'?: string | string[] | null
  /** 参数提示文本 */
  'argument-hint'?: string | null
  /** 何时使用该 Skill 的说明 */
  when_to_use?: string | null
  /** Skill 版本号 */
  version?: string | null
  /** 使用的模型名称 */
  model?: string | null
  /** 是否可由用户直接调用 */
  'user-invocable'?: string | null
  /** 执行所需的工作量描述 */
  effort?: string | null
  /** 参数定义列表 */
  arguments?: string | string[] | null
  [key: string]: unknown
}

/** 解析后的 markdown */
export interface ParsedMarkdown {
  /** 解析出的 frontmatter 数据 */
  frontmatter: FrontmatterData
  /** 去除 frontmatter 后的正文内容 */
  content: string
}

/** parseSkillFrontmatterFields 返回类型 */
export interface SkillFrontmatterFields {
  /** 显示名称 */
  displayName: string | undefined
  /** 描述信息 */
  description: string
  /** 允许使用的工具列表 */
  allowedTools: string[]
  /** 参数提示 */
  argumentHint: string | undefined
  /** 参数名称列表 */
  argumentNames: string[]
  /** 何时使用 */
  whenToUse: string | undefined
  /** 使用的模型 */
  model: string | undefined
  /** 是否禁用模型调用 */
  disableModelInvocation: boolean
  /** 是否可由用户调用 */
  userInvocable: boolean
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

/**
 * 解析 markdown 内容，提取 frontmatter 和正文
 */
export function parseFrontmatter(
  markdown: string,
): ParsedMarkdown {
  const match = markdown.match(FRONTMATTER_REGEX)

  if (!match) {
    return { frontmatter: {}, content: markdown }
  }

  const frontmatterText = match[1] || ''
  const content = markdown.slice(match[0].length)

  let frontmatter: FrontmatterData = {}
  try {
    const parsed = parseYaml(frontmatterText) as FrontmatterData | null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed
    }
  } catch {
    // YAML 解析失败时使用空 frontmatter
  }

  return { frontmatter, content }
}

/**
 * 解析 frontmatter 中的 boolean 值
 */
export function parseBooleanFrontmatter(value: unknown): boolean {
  return value === true || value === 'true'
}

/**
 * 解析 arguments 字段，支持逗号分隔的字符串或字符串数组
 */
export function parseArgumentNames(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(v => String(v)).filter(v => v.length > 0)
  }
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim()).filter(v => v.length > 0)
  }
  return []
}

/**
 * 解析 skill frontmatter 字段
 */
export function parseSkillFrontmatterFields(
  frontmatter: FrontmatterData,
  markdownContent: string,
  skillName: string,
): SkillFrontmatterFields {
  // description: 优先使用 frontmatter，否则从 markdown 提取
  let description = ''
  if (frontmatter.description && typeof frontmatter.description === 'string') {
    description = frontmatter.description.trim()
  }
  if (!description) {
    // fallback: 提取第一个 # 标题后的内容作为 description
    const headingMatch = markdownContent.match(/^#\s+(.+)$/m)
    if (headingMatch) {
      description = headingMatch[1]!.trim()
    } else {
      description = skillName
    }
  }

  // allowed-tools: 解析工具列表
  let allowedTools: string[] = []
  if (frontmatter['allowed-tools']) {
    if (Array.isArray(frontmatter['allowed-tools'])) {
      allowedTools = frontmatter['allowed-tools'].map(v => String(v))
    } else if (typeof frontmatter['allowed-tools'] === 'string') {
      allowedTools = frontmatter['allowed-tools'].split(',').map(v => v.trim())
    }
  }

  return {
    displayName: frontmatter.name != null ? String(frontmatter.name) : undefined,
    description,
    allowedTools,
    argumentHint: frontmatter['argument-hint'] != null ? String(frontmatter['argument-hint']) : undefined,
    argumentNames: parseArgumentNames(frontmatter.arguments),
    whenToUse: frontmatter.when_to_use != null ? String(frontmatter.when_to_use) : undefined,
    model: frontmatter.model != null ? String(frontmatter.model) : undefined,
    disableModelInvocation: parseBooleanFrontmatter(frontmatter['disable-model-invocation']),
    userInvocable: frontmatter['user-invocable'] === undefined ? true : parseBooleanFrontmatter(frontmatter['user-invocable']),
  }
}
