# Editing detail tables

Production commit: `925fc3c6f004552a8cdea9628699de9735682d01`. Dates: 2026-10-17. Source paths are in [editing-summary.json](editing-summary.json).

## Matched caret positions

| Tool | Format | Data size | Position | Verified runs | rAF median | rAF p95 | Output update | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|---|---|
| Tool Kumar | prettified | 100 KB | start | 3/3 | 22.0 ms | 64.6 ms | 311.0 ms | 100.0 ms | 67.0 ms |
| Tool Kumar | prettified | 100 KB | middle | 3/3 | 24.3 ms | 31.0 ms | 313.5 ms | 33.2 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 100 KB | end | 3/3 | 29.6 ms | 36.7 ms | 325.9 ms | 66.8 ms | 57.0 ms |
| Tool Kumar | minified | 100 KB | start | 3/3 | 106.6 ms | 1026.6 ms | 282.0 ms | 949.9 ms | 495.0 ms |
| Tool Kumar | minified | 100 KB | middle | 3/3 | 73.1 ms | 89.1 ms | 244.7 ms | 116.6 ms | 102.0 ms |
| Tool Kumar | minified | 100 KB | end | 3/3 | 41.8 ms | 55.0 ms | 212.7 ms | 50.1 ms | 60.0 ms |
| Tool Kumar | prettified | 10 MB | start | 3/3 | 16.0 ms | 26.6 ms | 2932.4 ms | 16.8 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 10 MB | middle | 3/3 | 16.8 ms | 33.1 ms | 3050.2 ms | 83.3 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 10 MB | end | 3/3 | 12.5 ms | 20.5 ms | 3329.1 ms | 33.3 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 10 MB | start | 3/3 | 11.1 ms | 31.5 ms | 2704.0 ms | 83.4 ms | 68.0 ms |
| Tool Kumar | minified | 10 MB | middle | 3/3 | 15.6 ms | 41.2 ms | 2780.8 ms | 83.2 ms | 73.0 ms |
| Tool Kumar | minified | 10 MB | end | 3/3 | 11.4 ms | 19.0 ms | 2579.0 ms | 33.4 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 1 MB | start | 3/3 | 17.1 ms | 18.6 ms | 830.2 ms | 16.8 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 1 MB | middle | 3/3 | 9.7 ms | 13.2 ms | Not measured | 16.8 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 1 MB | end | 3/3 | 11.0 ms | 16.9 ms | Not measured | 16.8 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 1 MB | start | 3/3 | 10.7 ms | 22.9 ms | 780.0 ms | 50.1 ms | No task at or above 50 ms recorded |
| Tool Kumar | minified | 1 MB | middle | 3/3 | 13.5 ms | 19.4 ms | Not measured | 50.1 ms | 66.0 ms |
| Tool Kumar | minified | 1 MB | end | 3/3 | 11.5 ms | 15.0 ms | Not measured | 33.3 ms | No task at or above 50 ms recorded |
| Tool Kumar | prettified | 50 MB | start | 0/4 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Tool Kumar | prettified | 50 MB | middle | 0/4 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Tool Kumar | prettified | 50 MB | end | 0/4 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Tool Kumar | minified | 50 MB | start | 0/4 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Tool Kumar | minified | 50 MB | middle | 0/4 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Tool Kumar | minified | 50 MB | end | 0/4 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 100 KB | start | 0/1 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 100 KB | middle | 0/1 | Not measured | Not measured | Not measured | Not measured | Not measured |
| Code Beautify JSON Viewer | minified | 100 KB | end | 0/1 | Not measured | Not measured | Not measured | Not measured | Not measured |
| JSON Beautifier | minified | 100 KB | start | 0/1 | Not measured | Not measured | Not measured | Not measured | Not measured |
| JSON Beautifier | minified | 100 KB | middle | 1/1 | 78.3 ms | 134.9 ms | Not measured | 149.9 ms | 138.0 ms |
| JSON Beautifier | minified | 100 KB | end | 1/1 | 50.7 ms | 116.2 ms | Not measured | 133.4 ms | 120.0 ms |
| JSON Formatter Online | prettified | 1 MB | start | 1/1 | 17.2 ms | 18.2 ms | 261.8 ms | 16.8 ms | No task at or above 50 ms recorded |
| JSON Formatter Online | prettified | 1 MB | middle | 1/1 | 25.4 ms | 29.0 ms | 267.3 ms | 100.0 ms | 74.0 ms |
| JSON Formatter Online | prettified | 1 MB | end | 1/1 | 25.9 ms | 27.1 ms | 359.0 ms | 83.4 ms | 74.0 ms |
| JSON Formatter Online | minified | 1 MB | start | 1/1 | 21.0 ms | 25.8 ms | 281.6 ms | 16.8 ms | No task at or above 50 ms recorded |
| JSON Formatter Online | minified | 1 MB | middle | 1/1 | 27.0 ms | 28.5 ms | Not measured | 33.3 ms | No task at or above 50 ms recorded |
| JSON Formatter Online | minified | 1 MB | end | 1/1 | 14.5 ms | 16.0 ms | Not measured | 16.8 ms | No task at or above 50 ms recorded |

## Enter, Backspace, snippet and Undo

| Tool | Format | Data size | Action | Median, ms | p95, ms | Action windows | Method and effect |
|---|---|---|---|---|---|---|---|
| Tool Kumar | prettified | 100 KB | enter | 69.5 ms | 77.6 ms | 9 | Trusted CDP key |
| Tool Kumar | prettified | 100 KB | backspace | 23.3 ms | 30.7 ms | 9 | Trusted CDP key |
| Tool Kumar | prettified | 100 KB | snippet | 23.0 ms | 34.2 ms | 9 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | prettified | 100 KB | undo | 368.0 ms | 406.1 ms | 9 | Ctrl+Z; snippet removal confirmed 9/9 |
| Tool Kumar | minified | 100 KB | enter | 135.8 ms | 186.9 ms | 9 | Trusted CDP key |
| Tool Kumar | minified | 100 KB | backspace | 79.2 ms | 150.7 ms | 9 | Trusted CDP key |
| Tool Kumar | minified | 100 KB | snippet | 72.1 ms | 86.2 ms | 9 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | minified | 100 KB | undo | 100.1 ms | 107.8 ms | 9 | Ctrl+Z; snippet removal confirmed 9/9 |
| Tool Kumar | prettified | 10 MB | enter | 45.8 ms | 166.0 ms | 9 | Trusted CDP key |
| Tool Kumar | prettified | 10 MB | backspace | 37.4 ms | 68.9 ms | 9 | Trusted CDP key |
| Tool Kumar | prettified | 10 MB | snippet | 24.8 ms | 61.1 ms | 9 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | prettified | 10 MB | undo | 23.9 ms | 61.6 ms | 9 | Ctrl+Z; snippet removal confirmed 9/9 |
| Tool Kumar | minified | 10 MB | enter | 20.1 ms | 35.2 ms | 9 | Trusted CDP key |
| Tool Kumar | minified | 10 MB | backspace | 13.0 ms | 23.6 ms | 9 | Trusted CDP key |
| Tool Kumar | minified | 10 MB | snippet | 38.9 ms | 84.5 ms | 9 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | minified | 10 MB | undo | 32.6 ms | 48.7 ms | 9 | Ctrl+Z; snippet removal confirmed 9/9 |
| Tool Kumar | prettified | 1 MB | enter | 17.0 ms | 101.4 ms | 9 | Trusted CDP key |
| Tool Kumar | prettified | 1 MB | backspace | 11.1 ms | 102.0 ms | 9 | Trusted CDP key |
| Tool Kumar | prettified | 1 MB | snippet | 16.5 ms | 95.0 ms | 9 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | prettified | 1 MB | undo | 13.3 ms | 32.6 ms | 9 | Ctrl+Z; snippet removal confirmed 9/9 |
| Tool Kumar | minified | 1 MB | enter | 11.6 ms | 81.0 ms | 9 | Trusted CDP key |
| Tool Kumar | minified | 1 MB | backspace | 10.6 ms | 34.3 ms | 9 | Trusted CDP key |
| Tool Kumar | minified | 1 MB | snippet | 14.0 ms | 48.1 ms | 9 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | minified | 1 MB | undo | 12.8 ms | 20.1 ms | 9 | Ctrl+Z; snippet removal confirmed 9/9 |
| Tool Kumar | prettified | 50 MB | enter | Not measured | Not measured | 0 | Trusted CDP key |
| Tool Kumar | prettified | 50 MB | backspace | Not measured | Not measured | 0 | Trusted CDP key |
| Tool Kumar | prettified | 50 MB | snippet | Not measured | Not measured | 0 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | prettified | 50 MB | undo | Not measured | Not measured | 0 | Ctrl+Z; snippet removal confirmed 0/0 |
| Tool Kumar | minified | 50 MB | enter | Not measured | Not measured | 0 | Trusted CDP key |
| Tool Kumar | minified | 50 MB | backspace | Not measured | Not measured | 0 | Trusted CDP key |
| Tool Kumar | minified | 50 MB | snippet | Not measured | Not measured | 0 | Trusted Ctrl+V from browser clipboard |
| Tool Kumar | minified | 50 MB | undo | Not measured | Not measured | 0 | Ctrl+Z; snippet removal confirmed 0/0 |
| Code Beautify JSON Viewer | minified | 100 KB | enter | Not measured | Not measured | 0 | Trusted CDP key |
| Code Beautify JSON Viewer | minified | 100 KB | backspace | Not measured | Not measured | 0 | Trusted CDP key |
| Code Beautify JSON Viewer | minified | 100 KB | snippet | Not measured | Not measured | 0 | Trusted Ctrl+V from browser clipboard |
| Code Beautify JSON Viewer | minified | 100 KB | undo | Not measured | Not measured | 0 | Ctrl+Z; snippet removal confirmed 0/0 |
| JSON Beautifier | minified | 100 KB | enter | 37.9 ms | 45.7 ms | 2 | Trusted CDP key |
| JSON Beautifier | minified | 100 KB | backspace | 29.9 ms | 33.5 ms | 2 | Trusted CDP key |
| JSON Beautifier | minified | 100 KB | snippet | 31.4 ms | 34.2 ms | 2 | Trusted Ctrl+V from browser clipboard |
| JSON Beautifier | minified | 100 KB | undo | 11.8 ms | 13.9 ms | 2 | Ctrl+Z; snippet removal confirmed 0/2 |
| JSON Formatter Online | prettified | 1 MB | enter | 35.7 ms | 39.5 ms | 3 | Trusted CDP key |
| JSON Formatter Online | prettified | 1 MB | backspace | 31.1 ms | 40.6 ms | 3 | Trusted CDP key |
| JSON Formatter Online | prettified | 1 MB | snippet | 30.5 ms | 32.2 ms | 3 | Trusted Ctrl+V from browser clipboard |
| JSON Formatter Online | prettified | 1 MB | undo | 26.5 ms | 26.9 ms | 3 | Ctrl+Z; snippet removal confirmed 3/3 |
| JSON Formatter Online | minified | 1 MB | enter | 70.0 ms | 82.5 ms | 3 | Trusted CDP key |
| JSON Formatter Online | minified | 1 MB | backspace | 23.0 ms | 64.9 ms | 3 | Trusted CDP key |
| JSON Formatter Online | minified | 1 MB | snippet | 54.0 ms | 89.2 ms | 3 | Trusted Ctrl+V from browser clipboard |
| JSON Formatter Online | minified | 1 MB | undo | 17.0 ms | 52.8 ms | 3 | Ctrl+Z; snippet removal confirmed 3/3 |
