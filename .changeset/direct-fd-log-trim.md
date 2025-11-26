---
'@portmux/core': patch
'@portmux/cli': patch
---

Write process logs directly to file descriptors again and trim at boundaries to avoid `portmux select` hanging from open stdout/stderr pipes.
