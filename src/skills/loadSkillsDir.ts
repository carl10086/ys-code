// src/skills/loadSkillsDir.ts
import { readdir, readFile } from 'fs/promises'
import type { Dirent } from 'fs'
import { join } from 'path'
import type { PromptCommand, SkillContentBlock } from '../commands/types.js'
import { parseFrontmatter, parseSkillFrontmatterFields } from './frontmatter.js'

/** 配置来源 */
export type SkillSource = 'projectSettings' | 'userSettings' | 'bundled'

/**
 * 从 skills 目录加载所有 skill
 * @param basePath - .claude/skills 目录路径
 * @param source - 配置来源
 */
export async function loadSkillsFromSkillsDir(
  basePath: string,
  source: SkillSource,
): Promise<PromptCommand[]> {
  const entries: Dirent[] = await readdir(basePath, { withFileTypes: true }).catch(() => [])

  const results = await Promise.all(
    entries.map(async (entry) => {
      // 只处理目录（skill-name/SKILL.md 格式）
      if (!entry.isDirectory()) {
        return null
      }

      const skillDirPath = join(basePath, entry.name)
      const skillFilePath = join(skillDirPath, 'SKILL.md')

      let content: string
      try {
        content = await readFile(skillFilePath, { encoding: 'utf-8' })
      } catch {
        // SKILL.md 不存在，跳过
        return null
      }

      const { frontmatter, content: markdownContent } = parseFrontmatter(content)
      const skillName = entry.name

      const parsed = parseSkillFrontmatterFields(
        frontmatter,
        markdownContent,
        skillName,
      )

      return createSkillCommand({
        skillName,
        markdownContent,
        baseDir: skillDirPath,
        source,
        ...parsed,
      })
    }),
  )

  return results.filter((r): r is PromptCommand => r !== null)
}

/**
 * 创建 skill command
 */
function createSkillCommand({
  skillName,
  displayName,
  description,
  markdownContent,
  allowedTools,
  argumentHint,
  argumentNames,
  whenToUse,
  model,
  disableModelInvocation,
  userInvocable,
  source,
  baseDir,
}: {
  /** skill 名称（唯一标识） */
  skillName: string
  /** 显示名称（可选，用于覆盖默认命名） */
  displayName: string | undefined
  /** skill 描述 */
  description: string
  /** markdown 内容正文 */
  markdownContent: string
  /** 允许使用的工具列表 */
  allowedTools: string[]
  /** 参数提示文字 */
  argumentHint: string | undefined
  /** 参数名称列表 */
  argumentNames: string[]
  /** 使用时机说明 */
  whenToUse: string | undefined
  /** 指定的模型（可选） */
  model: string | undefined
  /** 是否禁用模型调用 */
  disableModelInvocation: boolean
  /** 是否允许用户直接调用 */
  userInvocable: boolean
  /** 配置来源 */
  source: SkillSource
  /** skill 目录路径 */
  baseDir: string
}): PromptCommand {
  return {
    type: 'prompt',
    name: skillName,
    description,
    progressMessage: 'running',
    contentLength: markdownContent.length,
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    argumentHint,
    whenToUse,
    model,
    disableModelInvocation,
    userInvocable,
    source,
    getPromptForCommand: async (args: string): Promise<SkillContentBlock[]> => {
      let finalContent = markdownContent

      // 简单的参数替换: $ARGUMENTS 替换为实际参数
      if (args) {
        finalContent = finalContent.replace(/\$ARGUMENTS/g, args)
      }

      return [{ type: 'text', text: finalContent }]
    },
  }
}
