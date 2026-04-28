---
inclusion: auto
---

# 禁止使用路径点方案

对于滑雪游戏角色贴合地面的需求，**绝对不要使用手工路径点插值方案**（如 `_firstPathPoints` / `_loopPathPoints` / `getPathY()` / `lerpPoints()` 等）。

路径点方案位置偏移严重，贴合效果不准确，已被明确否决。

必须使用 2D 物理引擎（RigidBody2D + Collider2D）来实现角色贴合路面。如果遇到性能问题，应优化碰撞体生成方式（减少顶点数、优化采样等），而不是回退到路径点方案。
