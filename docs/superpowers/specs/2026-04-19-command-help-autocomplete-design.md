# 命令帮助与自动补全设计文档

> **目标**: 实现 `/help` 命令和输入 `/` 时的自动提示补全功能，对齐 claude-code 的交互体验。

## 背景

当前 `ys-code` 已经实现了基础的 command system（PR #6），包含 `exit`、`clear`、`tools` 三个命令。但用户无法：
1. 查看所有可用命令列表
2. 在输入时获得命令提示

本设计在现有 command system 基础上扩展帮助和自动补全能力。

## 架构

```
PromptInput.tsx
├── 输入监听（/ 开头触发）
├── 命令过滤逻辑（前缀匹配）
└── suggestion 状态管理（selectedIndex, items, visible）

CommandSuggestions.tsx
├── 建议列表渲染（命令名 + 描述）
└── 选中项高亮

/help 命令（local 类型）
└── 格式化输出所有可见命令
```

## 组件设计

### 1. /help 命令

**类型**: `local`
**功能**: 遍历 `COMMANDS` 数组，过滤隐藏命令，生成格式化的命令列表。

**输出示例**:
```
可用命令：

/clear    (new, reset)    清空会话历史
/exit     (quit)          退出 REPL
/help                     显示帮助信息
/tools                    列出所有可用工具
```

**排序规则**: 按命令名字母顺序排列。

### 2. 自动提示系统

#### 触发条件
- 输入框内容以 `/` 开头
- 光标位置在 `/` 之后
- 输入不含空格（即还未输入参数）

#### 过滤逻辑
使用 **Fuse.js** 进行模糊匹配（与 CC 一致）：

```
输入: "/"     → 显示所有非隐藏命令
输入: "/c"    → 显示 name 或 alias 以 "c" 开头的命令
输入: "/exi"  → 显示 name 或 alias 包含 "exi" 的命令（模糊匹配）
输入: "/cle " → 空格后隐藏提示（已进入参数阶段）
```

#### 排序规则
1. 精确名称匹配优先
2. 精确别名匹配优先
3. 前缀名称匹配优先
4. 前缀别名匹配优先
5. Fuse.js 分数（越低越匹配）

#### 交互映射

| 按键 | 行为 |
|------|------|
| `↑` / `↓` | 上下循环选择选中项 |
| `Tab` | 应用选中命令到输入框（追加空格，不执行） |
| `Enter` | 应用选中命令并执行 |
| `Escape` | 关闭提示列表 |
| 普通字符输入 | 实时过滤列表 |
| `Backspace` 删除 `/` | 关闭提示列表 |

#### UI 设计

```
> /c                    ← 输入框
─────────────────       ← 分隔线（dimColor）
/clear  清空会话历史    ← 选中项（cyan 高亮）
/exit   退出 REPL       ← 未选中项（gray）
```

- 最多显示 5 项
- 列表宽度自适应终端宽度
- 命令名右对齐，描述左对齐

### 3. PromptInput 状态扩展

```typescript
interface SuggestionState {
  visible: boolean;
  items: SuggestionItem[];
  selectedIndex: number;
}

interface SuggestionItem {
  id: string;           // 命令名
  displayText: string;  // /commandName
  description: string;  // 命令描述
  metadata: Command;    // 原始 Command 对象
}
```

### 4. 新增文件

- `src/commands/help/index.ts` — help 命令入口
- `src/commands/help/help.ts` — help 命令实现
- `src/tui/components/CommandSuggestions.tsx` — 提示列表渲染

### 5. 修改文件

- `src/commands/index.ts` — 注册 help 命令
- `src/tui/components/PromptInput.tsx` — 添加 suggestion 逻辑
- `src/tui/app.tsx` — 传递 commands 给 PromptInput

## 边界情况

1. **无匹配命令**: 显示 "无匹配的命令" 提示
2. **隐藏命令**: `isHidden` 的命令不出现在提示列表中
3. **终端高度不足**: 最多显示 5 项，超出时截断
4. **快速输入**: 输入变化时立即过滤，无需防抖（命令数量少）
5. **帮助命令自身**: `/help` 也应该出现在提示列表中

## 测试要点

1. `/help` 输出包含所有可见命令
2. 输入 `/` 显示所有命令
3. 输入 `/c` 只显示 `clear`
4. 上下键循环选择
5. Tab 应用命令但不执行
6. Enter 应用并执行命令
7. Escape 关闭列表

## 兼容性

- 不引入新依赖
- 保持现有 PromptInput 多行编辑功能不受影响
- 与现有命令系统（PR #6）完全兼容
