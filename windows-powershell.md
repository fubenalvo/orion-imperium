# Windows PowerShell Environment

## Operating environment

- OS: Windows 11
- Terminal shell: PowerShell
- This project is NOT running in Bash, sh, zsh, Linux, WSL, or Git Bash.

## CRITICAL: Terminal commands

When using the terminal, commands MUST be valid Windows PowerShell syntax.

NEVER use Unix/Linux commands:

- grep
- sed
- awk
- find
- cat
- rm
- mv
- cp
- touch
- head
- tail
- xargs
- chmod
- pwd

NEVER use Bash-specific syntax such as:

- `$(...)`
- `||`
- `&&`
- `>`
- `<`
- `2>/dev/null`
- `| grep`
- `find ... -exec`

Use PowerShell equivalents instead.

Examples:

- `grep` → `Select-String`
- `cat` → `Get-Content`
- `find` → `Get-ChildItem -Recurse`
- `rm` → `Remove-Item`
- `mv` → `Move-Item`
- `cp` → `Copy-Item`
- `pwd` → `Get-Location`
- `head` → `Select-Object -First`
- `tail` → `Select-Object -Last`

## Prefer Cline tools over terminal

For reading, searching, and modifying project files:

1. Prefer Cline's file/search/edit tools.
2. Use the terminal only when a terminal command is actually necessary.
3. Do NOT use `dir`, `ls`, `Get-ChildItem`, or similar commands merely to discover files when the file/search tools can do the job.
4. If the exact file path is already known, access that file directly.

## PowerShell quoting

Be especially careful with PowerShell string quoting.

Do NOT create single-quoted PowerShell strings containing unescaped single quotes.

For example, this is INVALID:

`'name: 'ICARUS''`

Prefer a PowerShell here-string for large multiline content:

@'
name: 'ICARUS'
x: 50
y: 50
'@

or use double-quoted strings when appropriate.

When constructing regular expressions or replacement text containing many quotes, prefer a here-string rather than attempting to escape a large multiline string inline.

## Variable interpolation

PowerShell variable names followed by a colon require explicit delimiting.

Do NOT write:

`"Line $lineNum: $_"`

Write:

`"Line ${lineNum}: $_"`

or use the format operator:

`'Line {0}: {1}' -f $lineNum, $_`

## File modifications

Prefer direct file editing tools for project files.

Do NOT use PowerShell commands to reconstruct an existing source file unless there is a compelling reason.

Do NOT:

1. create a replacement file,
2. delete the original,
3. rename the replacement,

when a direct edit is possible.

For a small change, modify only the relevant section.

Do NOT delete existing project files unless deletion is explicitly required by the task.

## Angular development server

The Angular development server is already running separately.

NEVER execute:

- `ng serve`
- `npm start`
- `npm run start`
- `npm run watch`

Do not start long-running development processes.

The existing development server should be allowed to detect source changes automatically.

Use `ng build` only when a finite build verification is required.

## Error recovery

If a PowerShell command fails because of syntax or quoting:

1. Do NOT immediately retry with another complex shell command.
2. Prefer using Cline's file/search/edit tools instead.
3. If a terminal command is necessary, simplify it substantially.
4. Do not repeat essentially the same failing command.

## Destructive commands

Commands such as these require explicit justification:

- Remove-Item
- del
- rmdir
- Remove-Item -Recurse
- git reset
- git clean

Do not use them merely as part of an editing strategy.

Existing source files should normally be edited in place.