import { Type, type Static } from '@sinclair/typebox';
import { readFile } from 'fs/promises';
import { defineAgentTool } from '../../define-agent-tool.js';
import type { AgentTool } from '../../types.js';
import type { ReadOutput } from './types.js';
import { expandPath, validateReadInput } from './validation.js';

const readSchema = Type.Object({
  path: Type.String({ description: '文件路径（相对或绝对路径）' }),
  offset: Type.Optional(Type.Number({ description: '起始行号（1-indexed）' })),
  limit: Type.Optional(Type.Number({ description: '最大读取行数' })),
});

type ReadInput = Static<typeof readSchema>;

const readOutputSchema = Type.Object({
  type: Type.String(),
  file: Type.Object({
    filePath: Type.String(),
    content: Type.String(),
    numLines: Type.Number(),
    startLine: Type.Number(),
    totalLines: Type.Number(),
  }),
});

function addLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(width, ' ');
      return `${lineNum}  ${line}`;
    })
    .join('\n');
}

export function createReadTool(cwd: string): AgentTool<typeof readSchema, ReadOutput> {
  return defineAgentTool({
    name: 'read',
    label: 'Read',
    description: 'Read the contents of a file.',
    parameters: readSchema,
    outputSchema: readOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,

    validateInput: async (params: ReadInput) => {
      const result = await validateReadInput(params.path, cwd);
      return result;
    },

    execute: async (toolCallId: string, params: ReadInput): Promise<ReadOutput> => {
      const fullPath = expandPath(params.path, cwd);
      const offset = params.offset ?? 1;
      const lineOffset = offset === 0 ? 0 : offset - 1;

      let text = await readFile(fullPath, 'utf-8');
      const allLines = text.split('\n');
      const totalLines = allLines.length;

      const start = Math.max(0, lineOffset);
      const end = params.limit !== undefined ? start + params.limit : totalLines;
      const selectedLines = allLines.slice(start, end);
      text = selectedLines.join('\n');

      const content = addLineNumbers(text, offset);
      const numLines = selectedLines.length;

      const output: ReadOutput = {
        type: 'text',
        file: {
          filePath: fullPath,
          content,
          numLines,
          startLine: offset,
          totalLines,
        },
      };

      return output;
    },

    formatResult: (output: ReadOutput) => {
      if (output.type === 'text') {
        return [{ type: 'text' as const, text: output.file.content }];
      }
      return [{ type: 'text' as const, text: '' }];
    },
  });
}
