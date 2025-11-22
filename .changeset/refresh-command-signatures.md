---
'@portmux/core': patch
---

Refresh stop logic so we can detect and kill exec'ed processes such as Ruby on Rails servers by capturing their true command line at start and refreshing it when verifying PIDs.
