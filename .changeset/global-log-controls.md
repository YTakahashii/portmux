---
'@portmux/core': patch
'@portmux/cli': patch
---

Write process logs directly to file descriptors and trim only at boundaries to avoid hanging `portmux select`, move the log size cap to global config for per-user control, and add a global `logs.disabled` switch to skip log output entirely.
