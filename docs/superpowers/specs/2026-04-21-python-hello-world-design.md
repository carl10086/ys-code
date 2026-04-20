# Python Hello World 示例设计

## 概述

创建一个入门级的 Python Hello World 示例文件，放在 `examples/` 目录下，供用户学习参考。

## 文件位置

`examples/hello.py`

## 代码内容

```python
# -*- coding: utf-8 -*-
"""Python Hello World 示例 - 入门级"""

# 变量示例
name = "World"
greeting = "Hello"

# 函数定义
def greet(person: str) -> str:
    """返回一个问候语"""
    return f"{greeting}, {person}!"

# 主程序入口
if __name__ == "__main__":
    print(greet(name))
```

## 展示的 Python 特性

| 特性 | 代码位置 |
|------|----------|
| 变量赋值 | `name = "World"`, `greeting = "Hello"` |
| 字符串 | 双引号字符串 |
| 函数定义 | `def greet(person: str) -> str:` |
| 类型注解 | `person: str`, `-> str` |
| f-string 插值 | `f"{greeting}, {person}!"` |
| `__main__` 入口 | `if __name__ == "__main__":` |

## 使用方式

```bash
python examples/hello.py
```

预期输出：
```
Hello, World!
```

## 设计决策

- **入门级复杂度**：选择包含变量和函数的版本，而非极简的单行 print，让读者了解 Python 基本语法结构
- **类型注解**：包含类型提示，符合现代 Python 实践
- **docstring**：函数包含文档字符串，展示 Python 文档惯例
