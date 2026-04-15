# Agent Math Example 设计

## 概述

在 `examples/agent-math.ts` 创建一个简单的示例，演示 Agent 如何使用 tools（加法、减法）。

## 功能

1. 定义两个简单的 math tools：
   - `add(a, b)` - 返回 a + b
   - `subtract(a, b)` - 返回 a - b

2. 创建 Agent 实例，配置 math tools

3. 发送数学问题 prompt

4. 打印 agent 事件和最终结果

## 文件结构

```
examples/
  agent-math.ts       # 新增
```

## 实现要点

- 使用 `@sinclair/typebox` 定义 tool parameters schema
- 工具执行是同步的简单函数
- 使用 `Agent` 类的 `subscribe` 监听事件
- 调用 `prompt()` 启动 agent
