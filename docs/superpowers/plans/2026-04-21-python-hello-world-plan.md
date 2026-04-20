# Python Hello World 示例实现计划

**Goal:** 创建 Python Hello World 入门示例

**Design:** `docs/superpowers/specs/2026-04-21-python-hello-world-design.md`

---

## Task 1: 创建 Python 示例文件

**Files:**
- Create: `examples/hello.py`

- [x] **Step 1: 创建文件**

创建 `examples/hello.py`，包含：
- 变量赋值（`name`, `greeting`）
- 带类型注解的函数定义（`def greet(person: str) -> str`）
- f-string 字符串插值
- `__main__` 入口模式

- [x] **Step 2: 验证 Python 语法**

```bash
python3 -m py_compile examples/hello.py
```

- [x] **Step 3: 运行测试**

```bash
python examples/hello.py
# Expected output: Hello, World!
```

- [x] **Step 4: Commit**

```bash
git add examples/hello.py
git commit -m "feat(examples): 添加 Python Hello World 入门示例"
```

---

## Task 2: 创建设计文档

**Files:**
- Create: `docs/superpowers/specs/2026-04-21-python-hello-world-design.md`

- [x] **Step 1: 编写设计文档**

记录文件位置、代码内容、展示的 Python 特性

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-21-python-hello-world-design.md
git commit -m "docs: 添加 Python Hello World 设计文档"
```

---

## 验证清单

- [x] `examples/hello.py` 文件存在且语法正确
- [x] `python examples/hello.py` 输出 `Hello, World!`
- [x] 设计文档已写入 `docs/superpowers/specs/`
