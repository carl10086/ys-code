---
description: Convert any input into a polished HTML page using the html-anything skill
---

Invoke the html-anything skill via subagent to generate a polished HTML page from the user's input.

## Input Parsing

Determine the input type from the user's command argument:

- **File path** — ends with an extension (`.csv`, `.md`, `.json`, etc.) or is a known file
- **Folder path** — a directory containing files
- **URL** — starts with `http://` or `https://`
- **Text brief** — anything else (an idea, topic, or description)

If no argument is provided, ask the user: "What would you like to convert to HTML? (file, folder, URL, or description)"

## Execution

Spawn the `html-anything` subagent using the Agent tool:

```
Agent tool:
  subagent_type: "html-anything"
  description: "Generate HTML from user input"
  prompt: |
    Input: <user-input>
    Input type: <file | folder | url | brief>
    Working directory: <current-directory>
    
    Generate the HTML artifact following skills/html-anything/SKILL.md.
    Return the result in the specified output format.
```

Wait for the subagent to complete and return its output.

## Response to User

Present the result in Chinese:

```markdown
**HTML 已生成**

- 文件路径：`<file-path>`
- 选用风格：`<style-name>`
- 内容概要：<summary>

请在浏览器中打开验证视觉效果。
如需调整，描述具体问题（如颜色、布局、交互等）。
```

## Rules

1. Always delegate the actual HTML generation to the `html-anything` subagent. Do not build HTML directly in the primary agent.
2. Pass the exact user input to the subagent without paraphrasing or summarizing.
3. If the subagent asks a clarifying question, relay it to the user.
4. After handoff, remind the user to verify in a browser.
