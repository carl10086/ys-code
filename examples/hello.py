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
