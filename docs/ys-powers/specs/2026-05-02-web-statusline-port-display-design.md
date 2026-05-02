# Web Endpoint Port Display in StatusBar

## Objective

当用户使用 `--web` 参数启动 ys-code 时，在 TUI 的 StatusBar 中显示当前 Web 服务器的端口号，让用户能够直观感知 Web 服务的运行状态。

## Context

当前 `--web` 参数已在 `src/main.ts` 中解析并启动 `Bun.serve` 服务器，但 web 服务器的端口/URL 信息未传递到 TUI 层，用户在 TUI 界面中无法感知 Web 服务是否已启动及其访问地址。

## Design

### Data Flow

```
src/main.ts
  createWebServer({ port: 0, hostname: "127.0.0.1" })
    ↓ returns { port, url, stop }
  startTUI({ webUrl: webServer.url })
    ↓
src/tui/index.tsx — startTUI 接收可选参数并传给 App
    ↓
src/tui/app.tsx — App 接收 webUrl prop 并传给 StatusBar
    ↓
src/tui/components/StatusBar.tsx — 解析 url 显示端口
```

### Interface Changes

#### `src/tui/index.tsx`

```typescript
interface StartTUIOptions {
  webUrl?: string;
}

export async function startTUI(options?: StartTUIOptions): Promise<void> {
  // ...
  const instance = await render(<App webUrl={options?.webUrl} />);
  // ...
}
```

#### `src/tui/app.tsx`

```typescript
interface AppProps {
  webUrl?: string;
}

export function App({ webUrl }: AppProps): React.ReactElement {
  // ...
  <StatusBar
    status={status}
    modelName={session.model.name}
    cwd={process.cwd()}
    gitBranch={gitBranch}
    totalTokens={totalTokens}
    contextWindow={session.model.contextWindow}
    webUrl={webUrl}
  />
}
```

#### `src/tui/components/StatusBar.tsx`

```typescript
export interface StatusBarProps {
  // ... existing props ...
  /** Web 服务器访问 URL（--web 启用时传入） */
  webUrl?: string;
}

// 端口提取逻辑
function extractPortFromUrl(url: string): string {
  try {
    return new URL(url).port;
  } catch {
    return "";
  }
}

// 渲染位置：第二行左侧，cwd 前面
{webUrl && (
  <Text color="magenta">[Web: {extractPortFromUrl(webUrl)}] </Text>
)}
```

### Visual Layout

StatusBar 第二行（从下往上数第二行）布局：

```
[Web: 8080] [~/project] [feat-branch]         [Context: 1.5K/8K ███░░░░ 18%]
^^^^^^^^^^^^  ^^^^^^^^^^  ^^^^^^^^^^           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 新增          原有 cwd    原有 git branch      原有 context info
```

- `webUrl` 未提供时：完全不渲染 web 相关部分，保持原有布局不变
- `webUrl` 提供时：在第二行最左侧插入 `[Web: {port}]`，以空格与后续内容分隔
- 颜色：`magenta`

## Testing Strategy

### Unit Tests

1. **`StatusBar` 组件测试**
   - 传入 `webUrl` 时，正确显示 `[Web: PORT]`
   - 未传入 `webUrl` 时，不显示 web 信息
   - 传入各种 URL 格式时正确解析端口号

2. **`extractPortFromUrl` 边界测试**
   - 标准 URL: `http://127.0.0.1:8080` → `8080`
   - 默认端口: `http://127.0.0.1/` → `""`（80端口不显示）
   - 无效 URL: `not-a-url` → `""`

### Manual Verification

1. 启动 `ys-code --web`，确认 StatusBar 第二行出现 `[Web: XXXX]`
2. 启动 `ys-code`（无 `--web`），确认 StatusBar 无 web 信息
3. 确认 web 端口与 `console.log` 输出的 URL 一致

## Boundaries

### Always Do
- 使用 `new URL()` 标准 API 解析端口号
- 保持 `StatusBarProps` 中 `webUrl` 为可选属性
- 仅显示端口号，不显示完整 URL（保持简洁）
- 与现有 StatusBar 风格保持一致（中括号包裹、颜色区分）

### Ask First About
- 是否需要在 URL 显示为可点击/交互元素（当前需求：纯展示）
- 是否需要在无 `--web` 时显示 `[Web: off]` 提示（当前需求：不显示）

### Never Do
- 引入全局状态管理或 Context 处理此单一 prop（保持简单传递）
- 在 StatusBar 中直接读取 process.env 或全局变量
- 修改 web server 的启动逻辑或端口分配策略
- 添加按键打开浏览器等交互功能（超出当前需求范围）

## Files to Modify

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/main.ts` | 修改 | 将 `webServer.url` 传入 `startTUI` |
| `src/tui/index.tsx` | 修改 | `startTUI` 接收可选参数，传给 App |
| `src/tui/app.tsx` | 修改 | App 接收 `webUrl` prop 并透传 |
| `src/tui/components/StatusBar.tsx` | 修改 | 新增 `webUrl` prop，渲染端口信息 |
| `src/tui/components/StatusBar.tsx` | 新增测试 | `extractPortFromUrl` 边界测试 |

## Acceptance Criteria

- [ ] `ys-code --web` 启动后，StatusBar 第二行左侧显示 `[Web: PORT]`
- [ ] `ys-code` 启动（无 `--web`），StatusBar 不显示任何 web 相关信息
- [ ] 显示的端口号与实际 `Bun.serve` 监听的端口一致
- [ ] 所有现有 StatusBar 测试继续通过
- [ ] 新增测试覆盖端口提取逻辑