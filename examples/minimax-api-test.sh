#!/bin/bash
# MiniMax API 请求路径验证脚本
# 正确的 baseURL: https://api.minimaxi.com/anthropic/v1
# SDK 会追加 /messages，所以最终路径是: https://api.minimaxi.com/anthropic/v1/messages

# 直接用 curl 发送请求验证路径
echo "=== 测试 MiniMax API 路径 ==="
echo "URL: https://api.minimaxi.com/anthropic/v1/messages"
echo ""

RESPONSE=$(curl -s -X POST "https://api.minimaxi.com/anthropic/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${MINIMAX_API_KEY}" \
  -d '{
    "model": "MiniMax-M2.7-highspeed",
    "max_tokens": 1024,
    "thinking": {"type": "enabled", "budget_tokens": 1024},
    "messages": [{"role": "user", "content": "What is 2+2? Use the calculator tool."}],
    "tools": [
      {
        "name": "calculator",
        "description": "A simple calculator",
        "input_schema": {
          "type": "object",
          "properties": {
            "expression": {
              "type": "string",
              "description": "Math expression to evaluate"
            }
          },
          "required": ["expression"]
        }
      }
    ]
  }')

echo "Response:"
echo "$RESPONSE" | head -c 500
echo ""

if echo "$RESPONSE" | grep -q "error"; then
  echo "---"
  echo "返回了错误，检查 API key 和路径是否正确"
else
  echo "---"
  echo "请求成功！"
fi
