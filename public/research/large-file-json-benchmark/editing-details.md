# Editing detail tables for the targeted refresh

Tool Kumar 95945cd and JSON Formatter Online 100 KB/10 MB cells are October 18. Other competitor cells are October 17. All use a 6 GiB browser budget. Source lists preserve each failed attempt.

## Tool Kumar, minified 100 KB, 2026-10-18; 95945cd

Editor design: {'editor': 'Custom virtual editor with a native textarea passage', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 12.7 ms | 15.1 ms | 177.4 ms | 3 | 16.8 ms | Not measured |
| middle | 3 | 9.4 ms | 14.5 ms | Not measured | 0 | 16.8 ms | Not measured |
| end | 3 | 12.4 ms | 16.9 ms | Not measured | 0 | 16.8 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb__editing1__2026-10-18T06-32-48-586Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb__editing2__2026-10-18T06-57-22-958Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb__editing3__2026-10-18T07-21-25-725Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb__editing1__2026-10-18T06-32-48-586Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb__editing2__2026-10-18T06-57-22-958Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb__editing3__2026-10-18T07-21-25-725Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 11.200000002980232,
        "p95": 37.29999999701977,
        "max": 37.29999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 6.5999999940395355,
        "p95": 37.69999998807907,
        "max": 37.69999998807907
      },
      "inputEventRaf": {
        "n": 9,
        "median": 4.299999997019768,
        "p95": 9.599999994039536,
        "max": 9.599999994039536
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 10.800000011920929,
        "p95": 16.900000005960464,
        "max": 16.900000005960464
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 11.5,
        "p95": 15.899999991059303,
        "max": 15.899999991059303
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Tool Kumar, prettified 100 KB, 2026-10-18; 95945cd

Editor design: {'editor': 'Native textarea with virtual syntax highlighting', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 19.4 ms | 27.5 ms | 300.0 ms | 3 | 16.8 ms | Not measured |
| middle | 3 | 24.2 ms | 29.3 ms | 303.4 ms | 3 | 16.8 ms | Not measured |
| end | 3 | 30.3 ms | 39.7 ms | 316.7 ms | 3 | 33.4 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb-pretty__editing1__2026-10-18T06-35-03-046Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb-pretty__editing2__2026-10-18T06-59-30-362Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb-pretty__editing3__2026-10-18T07-27-14-518Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb-pretty__editing1__2026-10-18T06-35-03-046Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb-pretty__editing2__2026-10-18T06-59-30-362Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__100kb-pretty__editing3__2026-10-18T07-27-14-518Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 73.5,
        "p95": 122.09999999403954,
        "max": 122.09999999403954
      },
      "inputEventRaf": {
        "n": 18,
        "median": 44.599999994039536,
        "p95": 98.30000001192093,
        "max": 98.30000001192093
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 29.19999998807907,
        "p95": 48.70000000298023,
        "max": 48.70000000298023
      },
      "inputEventRaf": {
        "n": 9,
        "median": 16.599999994039536,
        "p95": 30.599999994039536,
        "max": 30.599999994039536
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 36.599999994039536,
        "p95": 68.20000000298023,
        "max": 68.20000000298023
      },
      "inputEventRaf": {
        "n": 9,
        "median": 26.399999991059303,
        "p95": 56,
        "max": 56
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 345.79999999701977,
        "p95": 363.79999999701977,
        "max": 363.79999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Tool Kumar, minified 1 MB, 2026-10-18; 95945cd

Editor design: {'editor': 'Custom virtual editor with a native textarea passage', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 7.5 ms | 14.1 ms | 716.0 ms | 3 | 50.1 ms | Not measured |
| middle | 3 | 9.1 ms | 11.8 ms | Not measured | 0 | 33.4 ms | Not measured |
| end | 3 | 14.9 ms | 19.2 ms | Not measured | 0 | 33.3 ms | 1387.0 ms |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb__editing1__2026-10-18T06-39-22-454Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb__editing2__2026-10-18T07-03-55-015Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb__editing3__2026-10-18T07-31-40-293Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb__editing1__2026-10-18T06-39-22-454Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb__editing2__2026-10-18T07-03-55-015Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb__editing3__2026-10-18T07-31-40-293Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 9.799999997019768,
        "p95": 20.099999994039536,
        "max": 20.099999994039536
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 8.899999991059303,
        "p95": 16.5,
        "max": 16.5
      },
      "inputEventRaf": {
        "n": 9,
        "median": 6.399999991059303,
        "p95": 14.800000011920929,
        "max": 14.800000011920929
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 15,
        "p95": 38.5,
        "max": 38.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 15.299999997019768,
        "p95": 17.100000008940697,
        "max": 17.100000008940697
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Tool Kumar, prettified 1 MB, 2026-10-18; 95945cd

Editor design: {'editor': 'Custom virtual editor with a native textarea passage', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 13.1 ms | 14.1 ms | 796.1 ms | 3 | 16.8 ms | Not measured |
| middle | 3 | 8.7 ms | 18.5 ms | Not measured | 0 | 16.8 ms | Not measured |
| end | 3 | 13.2 ms | 18.6 ms | Not measured | 0 | 16.8 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb-pretty__editing1__2026-10-18T06-40-31-815Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb-pretty__editing2__2026-10-18T07-04-59-862Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb-pretty__editing3__2026-10-18T07-32-44-845Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb-pretty__editing1__2026-10-18T06-40-31-815Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb-pretty__editing2__2026-10-18T07-04-59-862Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__1mb-pretty__editing3__2026-10-18T07-32-44-845Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 15.599999994039536,
        "p95": 87.29999999701977,
        "max": 87.29999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 10.399999991059303,
        "p95": 84.5,
        "max": 84.5
      },
      "inputEventRaf": {
        "n": 9,
        "median": 5.9000000059604645,
        "p95": 16.700000002980232,
        "max": 16.700000002980232
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 13.200000002980232,
        "p95": 73.19999998807907,
        "max": 73.19999998807907
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 12.5,
        "p95": 17,
        "max": 17
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Tool Kumar, minified 10 MB, 2026-10-18; 95945cd

Editor design: {'editor': 'Custom virtual editor with a native textarea passage', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 8.0 ms | 19.8 ms | 248.1 ms | 3 | 66.8 ms | 55.0 ms |
| middle | 3 | 15.3 ms | 27.2 ms | 274.3 ms | 3 | 50.1 ms | Not measured |
| end | 3 | 17.3 ms | 18.4 ms | 248.1 ms | 3 | 16.8 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb__editing1__2026-10-18T06-41-50-866Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb__editing2__2026-10-18T07-06-12-309Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb__editing3__2026-10-18T07-33-57-530Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb__editing1__2026-10-18T06-41-50-866Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb__editing2__2026-10-18T07-06-12-309Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb__editing3__2026-10-18T07-33-57-530Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 18.099999994039536,
        "p95": 36.69999998807907,
        "max": 36.69999998807907
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 12.799999997019768,
        "p95": 13,
        "max": 13
      },
      "inputEventRaf": {
        "n": 9,
        "median": 3.7000000029802322,
        "p95": 4,
        "max": 4
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 32,
        "p95": 66.59999999403954,
        "max": 66.59999999403954
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 30,
        "p95": 44.70000000298023,
        "max": 44.70000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Tool Kumar, prettified 10 MB, 2026-10-18; 95945cd

Editor design: {'editor': 'Custom virtual editor with a native textarea passage', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 12.4 ms | 21.8 ms | 252.3 ms | 3 | 33.4 ms | Not measured |
| middle | 3 | 14.0 ms | 16.7 ms | 257.4 ms | 3 | 16.8 ms | Not measured |
| end | 3 | 16.5 ms | 18.2 ms | 254.1 ms | 3 | 16.8 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb-pretty__editing1__2026-10-18T06-45-08-355Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb-pretty__editing2__2026-10-18T07-09-28-032Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb-pretty__editing3__2026-10-18T07-37-24-573Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb-pretty__editing1__2026-10-18T06-45-08-355Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb-pretty__editing2__2026-10-18T07-09-28-032Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__10mb-pretty__editing3__2026-10-18T07-37-24-573Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 37.70000000298023,
        "p95": 48.5,
        "max": 48.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 30.900000005960464,
        "p95": 55.19999998807907,
        "max": 55.19999998807907
      },
      "inputEventRaf": {
        "n": 9,
        "median": 29.400000005960464,
        "p95": 47.19999998807907,
        "max": 47.19999998807907
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 19.900000005960464,
        "p95": 25.700000002980232,
        "max": 25.700000002980232
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 23.299999997019768,
        "p95": 24.900000005960464,
        "max": 24.900000005960464
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Tool Kumar, minified 50 MB, 2026-10-18; 95945cd

Editor design: {'editor': 'Custom virtual editor with a native textarea passage', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 7.5 ms | 29.8 ms | 326.8 ms | 3 | 99.9 ms | 82.0 ms |
| middle | 3 | 17.6 ms | 30.2 ms | Not measured | 0 | 83.3 ms | 86.0 ms |
| end | 3 | 5.6 ms | 18.3 ms | Not measured | 0 | 33.4 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb__editing1__2026-10-18T06-49-47-446Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb__editing2__2026-10-18T07-14-05-464Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb__editing3__2026-10-18T07-41-34-887Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb__editing1__2026-10-18T06-49-47-446Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb__editing2__2026-10-18T07-14-05-464Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb__editing3__2026-10-18T07-41-34-887Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 17.5,
        "p95": 117.29999999701977,
        "max": 117.29999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 9.299999997019768,
        "p95": 18.700000002980232,
        "max": 18.700000002980232
      },
      "inputEventRaf": {
        "n": 9,
        "median": 7.0999999940395355,
        "p95": 13.300000011920929,
        "max": 13.300000011920929
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 16.5,
        "p95": 70.8999999910593,
        "max": 70.8999999910593
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 12.700000002980232,
        "p95": 61.099999994039536,
        "max": 61.099999994039536
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Tool Kumar, prettified 50 MB, 2026-10-18; 95945cd

Editor design: {'editor': 'Custom virtual editor with a native textarea passage', 'update': 'Live formatted view', 'output': '#view-format'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 34.0 ms | 53.8 ms | 353.1 ms | 3 | 116.8 ms | 104.0 ms |
| middle | 3 | 30.5 ms | 35.7 ms | Not measured | 0 | 33.5 ms | Not measured |
| end | 3 | 28.0 ms | 34.1 ms | Not measured | 0 | 66.6 ms | 52.0 ms |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb-pretty__editing1__2026-10-18T06-53-08-358Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb-pretty__editing2__2026-10-18T07-17-15-781Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb-pretty__editing3__2026-10-18T07-44-52-146Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb-pretty__editing1__2026-10-18T06-53-08-358Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb-pretty__editing2__2026-10-18T07-17-15-781Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/tool-kumar__50mb-pretty__editing3__2026-10-18T07-44-52-146Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 119.20000000298023,
        "p95": 190.5,
        "max": 190.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 72.3999999910593,
        "p95": 136.3999999910593,
        "max": 136.3999999910593
      },
      "inputEventRaf": {
        "n": 9,
        "median": 70.90000000596046,
        "p95": 135.20000000298023,
        "max": 135.20000000298023
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 44.8999999910593,
        "p95": 115.40000000596046,
        "max": 115.40000000596046
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 34.70000000298023,
        "p95": 56.29999999701977,
        "max": 56.29999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## Code Beautify JSON Viewer, minified 100 KB, 2026-10-17; public site

Editor design: {'editor': 'Ace input, JSONEditor tree output', 'update': 'Auto Update enabled by default', 'output': '.jsoneditor-mode-view .jsoneditor-tree'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing1__2026-10-17T18-59-06-031Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing2__2026-10-17T20-21-42-243Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing3__2026-10-17T21-02-40-101Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing1__2026-10-17T18-59-06-031Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing2__2026-10-17T20-21-42-243Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb__editing3__2026-10-17T21-02-40-101Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## Code Beautify JSON Viewer, prettified 100 KB, 2026-10-17; public site

Editor design: {'editor': 'Ace input, JSONEditor tree output', 'update': 'Auto Update enabled by default', 'output': '.jsoneditor-mode-view .jsoneditor-tree'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing1__2026-10-17T19-10-34-176Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing2__2026-10-17T20-12-46-736Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing3__2026-10-17T21-12-30-963Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing1__2026-10-17T19-10-34-176Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing2__2026-10-17T20-12-46-736Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__100kb-pretty__editing3__2026-10-17T21-12-30-963Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## Code Beautify JSON Viewer, minified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace input, JSONEditor tree output', 'update': 'Auto Update enabled by default', 'output': '.jsoneditor-mode-view .jsoneditor-tree'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing1__2026-10-17T19-22-39-447Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing2__2026-10-17T20-39-51-767Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing3__2026-10-17T21-19-50-826Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing1__2026-10-17T19-22-39-447Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing2__2026-10-17T20-39-51-767Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb__editing3__2026-10-17T21-19-50-826Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## Code Beautify JSON Viewer, prettified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace input, JSONEditor tree output', 'update': 'Auto Update enabled by default', 'output': '.jsoneditor-mode-view .jsoneditor-tree'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing1__2026-10-17T19-42-18-379Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing2__2026-10-17T20-28-45-817Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing3__2026-10-17T21-31-24-518Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing1__2026-10-17T19-42-18-379Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing2__2026-10-17T20-28-45-817Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__1mb-pretty__editing3__2026-10-17T21-31-24-518Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## Code Beautify JSON Viewer, minified 10 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace input, JSONEditor tree output', 'update': 'Auto Update enabled by default', 'output': '.jsoneditor-mode-view .jsoneditor-tree'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing1__2026-10-17T19-49-59-338Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing2__2026-10-17T20-59-25-369Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing3__2026-10-17T21-39-06-960Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing1__2026-10-17T19-49-59-338Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "Memory watchdog stop during editing preparation",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "browser memory 6154 MiB exceeded the 6144 MiB cap",
      "memoryStop": {
        "reason": "browser memory 6154 MiB exceeded the 6144 MiB cap",
        "atMs": 74972,
        "browserMiB": 6154,
        "memAvailableMiB": 6293
      }
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing2__2026-10-17T20-59-25-369Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "Memory watchdog stop during editing preparation",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "browser memory 6148 MiB exceeded the 6144 MiB cap",
      "phase": "source restoration",
      "memoryStop": {
        "reason": "browser memory 6148 MiB exceeded the 6144 MiB cap",
        "atMs": 63549,
        "browserMiB": 6148,
        "memAvailableMiB": 5957
      }
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb__editing3__2026-10-17T21-39-06-960Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "Memory watchdog stop during editing preparation",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "browser memory 6146 MiB exceeded the 6144 MiB cap",
      "memoryStop": {
        "reason": "browser memory 6146 MiB exceeded the 6144 MiB cap",
        "atMs": 71158,
        "browserMiB": 6146,
        "memAvailableMiB": 5924
      }
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## Code Beautify JSON Viewer, prettified 10 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace input, JSONEditor tree output', 'update': 'Auto Update enabled by default', 'output': '.jsoneditor-mode-view .jsoneditor-tree'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing1__2026-10-17T19-58-45-642Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing2__2026-10-17T20-50-12-958Z.json, results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing3__2026-10-17T21-50-10-706Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing1__2026-10-17T19-58-45-642Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing2__2026-10-17T20-50-12-958Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/code-beautify-json-viewer__10mb-pretty__editing3__2026-10-17T21-50-10-706Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## JSON Beautifier, minified 100 KB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 65.2 ms | 136.9 ms | 314.9 ms | 3 | 266.6 ms | 256.0 ms |
| middle | 4 | 61.7 ms | 127.3 ms | 369.9 ms | 1 | 166.7 ms | 149.0 ms |
| end | 4 | 36.4 ms | 116.1 ms | 22.0 ms | 2 | 150.1 ms | 149.0 ms |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing1__2026-10-17T17-50-33-916Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing2__2026-10-17T20-20-47-751Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing2__2026-10-17T21-51-30-241Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing3__2026-10-17T21-03-38-099Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing1__2026-10-17T17-50-33-916Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing2__2026-10-17T20-20-47-751Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "start: Ace caret clamped before target: {\"method\":\"Ace public gotoLine, caret only\",\"cursor\":{\"row\":0,\"column\":1},\"lines\":7945,\"requestedLine\":1,\"requestedColumn\":354,\"targetLineCharacters\":1,\"visibleSourcePrefix\":\"{\"}",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing2__2026-10-17T21-51-30-241Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb__editing3__2026-10-17T21-03-38-099Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 11,
        "median": 41.20000000298023,
        "p95": 149.5,
        "max": 149.5
      },
      "inputEventRaf": {
        "n": 11,
        "median": 39,
        "p95": 147.30000000447035,
        "max": 147.30000000447035
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11
    },
    "backspace": {
      "raf": {
        "n": 11,
        "median": 34.599999994039536,
        "p95": 100.29999999701977,
        "max": 100.29999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11
    },
    "snippet": {
      "raf": {
        "n": 11,
        "median": 31.700000002980232,
        "p95": 103.90000000596046,
        "max": 103.90000000596046
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 11,
        "median": 11.700000002980232,
        "p95": 21.5,
        "max": 21.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        }
      ]
    }
  }
}

## JSON Beautifier, prettified 100 KB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 13.7 ms | 16.2 ms | 204.7 ms | 3 | 16.8 ms | Not measured |
| middle | 3 | 10.3 ms | 18.1 ms | 207.4 ms | 2 | 16.8 ms | Not measured |
| end | 3 | 6.5 ms | 15.1 ms | 216.1 ms | 2 | 16.8 ms | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb-pretty__editing1__2026-10-17T19-12-19-087Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb-pretty__editing2__2026-10-17T20-11-47-264Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb-pretty__editing3__2026-10-17T21-13-27-113Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb-pretty__editing1__2026-10-17T19-12-19-087Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb-pretty__editing2__2026-10-17T20-11-47-264Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__100kb-pretty__editing3__2026-10-17T21-13-27-113Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 9.699999995529652,
        "p95": 24,
        "max": 24
      },
      "inputEventRaf": {
        "n": 9,
        "median": 7,
        "p95": 12.199999995529652,
        "max": 12.199999995529652
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 15,
        "p95": 23.299999997019768,
        "max": 23.299999997019768
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 9.700000002980232,
        "p95": 16.200000002980232,
        "max": 16.200000002980232
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 12.600000008940697,
        "p95": 17.200000002980232,
        "max": 17.200000002980232
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        }
      ]
    }
  }
}

## JSON Beautifier, minified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 1174.8 ms | 1539.3 ms | 2098.2 ms | 3 | 1616.6 ms | 1158.0 ms |
| middle | 6 | 1182.9 ms | 1627.7 ms | Not measured | 0 | 1883.2 ms | 1373.0 ms |
| end | 6 | 1170.5 ms | 1572.6 ms | 2223.3 ms | 1 | 1733.1 ms | 1218.0 ms |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing1__2026-10-17T19-28-09-152Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing1__2026-10-17T21-47-57-873Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing2__2026-10-17T20-38-10-720Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing2__2026-10-17T21-54-07-481Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing3__2026-10-17T21-21-15-854Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing3__2026-10-17T21-58-06-385Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing1__2026-10-17T19-28-09-152Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "start: Ace caret clamped before target: {\"method\":\"Ace public gotoLine, caret only\",\"cursor\":{\"row\":0,\"column\":1},\"lines\":79196,\"requestedLine\":1,\"requestedColumn\":355,\"targetLineCharacters\":1,\"visibleSourcePrefix\":\"{\"}",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing1__2026-10-17T21-47-57-873Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing2__2026-10-17T20-38-10-720Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "start: Ace caret clamped before target: {\"method\":\"Ace public gotoLine, caret only\",\"cursor\":{\"row\":0,\"column\":1},\"lines\":79196,\"requestedLine\":1,\"requestedColumn\":355,\"targetLineCharacters\":1,\"visibleSourcePrefix\":\"{\"}",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing2__2026-10-17T21-54-07-481Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing3__2026-10-17T21-21-15-854Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "start: Ace caret clamped before target: {\"method\":\"Ace public gotoLine, caret only\",\"cursor\":{\"row\":0,\"column\":1},\"lines\":79196,\"requestedLine\":1,\"requestedColumn\":355,\"targetLineCharacters\":1,\"visibleSourcePrefix\":\"{\"}",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb__editing3__2026-10-17T21-58-06-385Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 15,
        "median": 80.70000000298023,
        "p95": 145.5,
        "max": 145.5
      },
      "inputEventRaf": {
        "n": 15,
        "median": 77.19999998807907,
        "p95": 136.5,
        "max": 136.5
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 15
    },
    "backspace": {
      "raf": {
        "n": 15,
        "median": 61.099999994039536,
        "p95": 198.09999999403954,
        "max": 198.09999999403954
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 15
    },
    "snippet": {
      "raf": {
        "n": 15,
        "median": 58,
        "p95": 67.6000000089407,
        "max": 67.6000000089407
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 15,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 15,
        "median": 58.3999999910593,
        "p95": 84.70000000298023,
        "max": 84.70000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 15,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        }
      ]
    }
  }
}

## JSON Beautifier, prettified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 7.2 ms | 10.5 ms | 393.7 ms | 3 | 33.3 ms | Not measured |
| middle | 3 | 11.0 ms | 14.0 ms | 347.3 ms | 3 | 16.8 ms | Not measured |
| end | 3 | 13.1 ms | 18.2 ms | Not measured | 0 | 16.8 ms | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb-pretty__editing1__2026-10-17T19-43-32-895Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb-pretty__editing2__2026-10-17T20-27-40-598Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb-pretty__editing3__2026-10-17T21-32-41-503Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb-pretty__editing1__2026-10-17T19-43-32-895Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb-pretty__editing2__2026-10-17T20-27-40-598Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__1mb-pretty__editing3__2026-10-17T21-32-41-503Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 12.400000005960464,
        "p95": 35.30000001192093,
        "max": 35.30000001192093
      },
      "inputEventRaf": {
        "n": 9,
        "median": 10.299999997019768,
        "p95": 16.299999997019768,
        "max": 16.299999997019768
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 8.899999991059303,
        "p95": 15.5,
        "max": 15.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 10.700000002980232,
        "p95": 26.099999994039536,
        "max": 26.099999994039536
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 11.100000008940697,
        "p95": 17.5,
        "max": 17.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        }
      ]
    }
  }
}

## JSON Beautifier, minified 10 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing1__2026-10-17T19-51-23-171Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing2__2026-10-17T20-58-34-066Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing3__2026-10-17T21-40-31-129Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing1__2026-10-17T19-51-23-171Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing2__2026-10-17T20-58-34-066Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb__editing3__2026-10-17T21-40-31-129Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}

## JSON Beautifier, prettified 10 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 1 | 13.5 ms | 43.3 ms | 1544.1 ms | 1 | 83.4 ms | 69.0 ms |
| middle | 1 | 7.1 ms | 11.2 ms | Not measured | 0 | 16.8 ms | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing1__2026-10-17T20-00-02-692Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing2__2026-10-17T20-49-16-758Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing3__2026-10-17T21-52-31-313Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing1__2026-10-17T20-00-02-692Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing2__2026-10-17T20-49-16-758Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__10mb-pretty__editing3__2026-10-17T21-52-31-313Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 1,
        "median": 40.400000005960464,
        "p95": 40.400000005960464,
        "max": 40.400000005960464
      },
      "inputEventRaf": {
        "n": 1,
        "median": 18.700000002980232,
        "p95": 18.700000002980232,
        "max": 18.700000002980232
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 1
    },
    "backspace": {
      "raf": {
        "n": 1,
        "median": 30.099999994039536,
        "p95": 30.099999994039536,
        "max": 30.099999994039536
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 1
    },
    "snippet": {
      "raf": {
        "n": 1,
        "median": 29.700000002980232,
        "p95": 29.700000002980232,
        "max": 29.700000002980232
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 1,
      "methods": [
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 1,
        "median": 12.200000002980232,
        "p95": 12.200000002980232,
        "max": 12.200000002980232
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 1,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": null
        }
      ]
    }
  }
}

## JSON Beautifier, minified 50 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing1__2026-10-17T22-10-06-305Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing2__2026-10-17T22-33-37-144Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing3__2026-10-17T22-39-06-305Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing1__2026-10-17T22-10-06-305Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing2__2026-10-17T22-33-37-144Z.json",
      "opening": "crashed",
      "rawOpeningStatus": "crashed",
      "reason": "Runtime.evaluate: timeout 64586.386442999996ms",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb__editing3__2026-10-17T22-39-06-305Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "Memory watchdog stop during editing preparation",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "browser memory 6145 MiB exceeded the 6144 MiB cap",
      "phase": "source restoration",
      "memoryStop": {
        "reason": "browser memory 6145 MiB exceeded the 6144 MiB cap",
        "atMs": 173028,
        "browserMiB": 6145,
        "memAvailableMiB": 5938
      }
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}

## JSON Beautifier, prettified 50 MB, 2026-10-17; public site

Editor design: {'editor': 'Ace', 'update': 'Beautify button', 'output': '.ace_editor:nth-of-type(2)'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing1__2026-10-17T22-17-50-729Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing2__2026-10-17T22-26-30-958Z.json, results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing3__2026-10-17T22-46-42-714Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing1__2026-10-17T22-17-50-729Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing2__2026-10-17T22-26-30-958Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Input.dispatchKeyEvent: timeout 15000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-beautifier__50mb-pretty__editing3__2026-10-17T22-46-42-714Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 30000ms",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}

## JSON Viewer Stack, minified 100 KB, 2026-10-17; public site

Editor design: {'editor': 'Textarea, Ext tree output', 'update': 'Viewer tab', 'output': '.x-tree-root-ct'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 1 | 30.5 ms | 40.9 ms | Not measured | 0 | 16.8 ms | Not measured |
| middle | 1 | 28.3 ms | 30.9 ms | Not measured | 0 | 16.8 ms | Not measured |
| end | 1 | 28.7 ms | 36.1 ms | Not measured | 0 | 16.8 ms | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing1__2026-10-17T19-01-09-368Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing2__2026-10-17T20-20-29-829Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing3__2026-10-17T21-04-50-782Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing1__2026-10-17T19-01-09-368Z.json",
      "opening": "view detected, interaction obstructed",
      "rawOpeningStatus": "ok",
      "editing": "could not be measured",
      "rawEditingStatus": "could not be measured",
      "reason": "interaction obstructed by another element",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing2__2026-10-17T20-20-29-829Z.json",
      "opening": "view detected, interaction obstructed",
      "rawOpeningStatus": "ok",
      "editing": "could not be measured",
      "rawEditingStatus": "could not be measured",
      "reason": "interaction obstructed by another element",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb__editing3__2026-10-17T21-04-50-782Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 3,
        "median": 48.400000005960464,
        "p95": 64.5,
        "max": 64.5
      },
      "inputEventRaf": {
        "n": 3,
        "median": 4.5,
        "p95": 4.600000008940697,
        "max": 4.600000008940697
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 3
    },
    "backspace": {
      "raf": {
        "n": 3,
        "median": 28.100000008940697,
        "p95": 29.200000002980232,
        "max": 29.200000002980232
      },
      "inputEventRaf": {
        "n": 3,
        "median": 4.700000002980232,
        "p95": 4.799999997019768,
        "max": 4.799999997019768
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 3
    },
    "snippet": {
      "raf": {
        "n": 3,
        "median": 29,
        "p95": 36.5,
        "max": 36.5
      },
      "inputEventRaf": {
        "n": 3,
        "median": 4.9000000059604645,
        "p95": 5,
        "max": 5
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 3,
      "methods": [
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 3,
        "median": 27.5,
        "p95": 30.599999994039536,
        "max": 30.599999994039536
      },
      "inputEventRaf": {
        "n": 3,
        "median": 9.100000008940697,
        "p95": 11.399999991059303,
        "max": 11.399999991059303
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 3,
      "confirmedEffects": 3,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSON Viewer Stack, prettified 100 KB, 2026-10-17; public site

Editor design: None

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing1__2026-10-17T19-14-10-090Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing2__2026-10-17T20-09-59-975Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing3__2026-10-17T21-14-25-243Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing1__2026-10-17T19-14-10-090Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.914643ms",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing2__2026-10-17T20-09-59-975Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.905321ms",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__100kb-pretty__editing3__2026-10-17T21-14-25-243Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.906347ms",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}

## JSON Viewer Stack, minified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'Textarea, Ext tree output', 'update': 'Viewer tab', 'output': '.x-tree-root-ct'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 3122.6 ms | 4022.4 ms | Not measured | 0 | 2299.9 ms | 2767.0 ms |
| middle | 3 | 3118.0 ms | 4017.9 ms | Not measured | 0 | 3733.2 ms | 2573.0 ms |
| end | 3 | 3002.1 ms | 3901.1 ms | Not measured | 0 | 1633.3 ms | 2349.0 ms |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb__editing1__2026-10-17T19-30-32-430Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb__editing2__2026-10-17T20-36-39-860Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb__editing3__2026-10-17T21-23-06-975Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb__editing1__2026-10-17T19-30-32-430Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb__editing2__2026-10-17T20-36-39-860Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb__editing3__2026-10-17T21-23-06-975Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 410.40000000596046,
        "p95": 475.59999999403954,
        "max": 475.59999999403954
      },
      "inputEventRaf": {
        "n": 9,
        "median": 34,
        "p95": 41.79999999701977,
        "max": 41.79999999701977
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 273.29999999701977,
        "p95": 338.30000001192093,
        "max": 338.30000001192093
      },
      "inputEventRaf": {
        "n": 9,
        "median": 35.70000000298023,
        "p95": 41.6000000089407,
        "max": 41.6000000089407
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 256.79999999701977,
        "p95": 314.59999999403954,
        "max": 314.59999999403954
      },
      "inputEventRaf": {
        "n": 9,
        "median": 38.599999994039536,
        "p95": 45.900000005960464,
        "max": 45.900000005960464
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 253.79999999701977,
        "p95": 295.5,
        "max": 295.5
      },
      "inputEventRaf": {
        "n": 9,
        "median": 81.3999999910593,
        "p95": 112.20000000298023,
        "max": 112.20000000298023
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSON Viewer Stack, prettified 1 MB, 2026-10-17; public site

Editor design: None

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing1__2026-10-17T19-44-35-456Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing2__2026-10-17T20-25-53-751Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing3__2026-10-17T21-33-44-430Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing1__2026-10-17T19-44-35-456Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.887762ms",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing2__2026-10-17T20-25-53-751Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.915127ms",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__1mb-pretty__editing3__2026-10-17T21-33-44-430Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.90706900001ms",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}

## JSON Viewer Stack, minified 10 MB, 2026-10-17; public site

Editor design: {'editor': 'Textarea, Ext tree output', 'update': 'Viewer tab', 'output': '.x-tree-root-ct'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing1__2026-10-17T19-52-13-586Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing2__2026-10-17T20-57-10-637Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing3__2026-10-17T21-41-25-129Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing1__2026-10-17T19-52-13-586Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing2__2026-10-17T20-57-10-637Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb__editing3__2026-10-17T21-41-25-129Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## JSON Viewer Stack, prettified 10 MB, 2026-10-17; public site

Editor design: None

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing1__2026-10-17T20-00-59-280Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing2__2026-10-17T20-47-29-275Z.json, results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing3__2026-10-17T21-56-19-900Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing1__2026-10-17T20-00-59-280Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.901186ms",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing2__2026-10-17T20-47-29-275Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.907898ms",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-viewer-stack__10mb-pretty__editing3__2026-10-17T21-56-19-900Z.json",
      "opening": "error",
      "rawOpeningStatus": "error",
      "reason": "error: Runtime.evaluate: timeout 89999.867241ms",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}

## JSON Formatter Online, minified 100 KB, 2026-10-18; public site

Editor design: {'editor': 'CodeMirror', 'update': 'Format button rewrites the same editor', 'output': '.cm-content'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 16.4 ms | 39.1 ms | 252.8 ms | 3 | 50.0 ms | Not measured |
| middle | 3 | 22.5 ms | 63.7 ms | Not measured | 0 | 83.4 ms | 66.0 ms |
| end | 3 | 13.4 ms | 38.2 ms | Not measured | 0 | 33.3 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb__editing1__2026-10-18T06-33-58-406Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb__editing2__2026-10-18T06-58-25-534Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb__editing3__2026-10-18T07-22-37-253Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb__editing1__2026-10-18T06-33-58-406Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb__editing2__2026-10-18T06-58-25-534Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb__editing3__2026-10-18T07-22-37-253Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 61.80000001192093,
        "p95": 142.70000000298023,
        "max": 142.70000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 23.5,
        "p95": 73.20000000298023,
        "max": 73.20000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 48.8999999910593,
        "p95": 132.20000000298023,
        "max": 132.20000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 24.599999994039536,
        "p95": 202.6000000089407,
        "max": 202.6000000089407
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSON Formatter Online, prettified 100 KB, 2026-10-18; public site

Editor design: {'editor': 'CodeMirror', 'update': 'Format button rewrites the same editor', 'output': '.cm-content'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 10.9 ms | 18.4 ms | Not measured | 0 | 16.8 ms | Not measured |
| middle | 3 | 16.3 ms | 17.5 ms | Not measured | 0 | 16.8 ms | Not measured |
| end | 3 | 11.4 ms | 17.4 ms | Not measured | 0 | 16.8 ms | Not measured |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb-pretty__editing1__2026-10-18T06-38-41-555Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb-pretty__editing2__2026-10-18T07-03-13-255Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb-pretty__editing3__2026-10-18T07-30-58-655Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb-pretty__editing1__2026-10-18T06-38-41-555Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb-pretty__editing2__2026-10-18T07-03-13-255Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__100kb-pretty__editing3__2026-10-18T07-30-58-655Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 13.199999988079071,
        "p95": 22.599999994039536,
        "max": 22.599999994039536
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 8.300000011920929,
        "p95": 15.400000005960464,
        "max": 15.400000005960464
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 9.599999994039536,
        "p95": 27.100000008940697,
        "max": 27.100000008940697
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 11.399999991059303,
        "p95": 17,
        "max": 17
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSON Formatter Online, minified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'CodeMirror', 'update': 'Format button rewrites the same editor', 'output': '.cm-content'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 21.4 ms | 29.0 ms | 284.7 ms | 3 | 16.8 ms | Not measured |
| middle | 3 | 28.5 ms | 36.6 ms | Not measured | 0 | 183.4 ms | 63.0 ms |
| end | 3 | 15.7 ms | 20.1 ms | Not measured | 0 | 16.8 ms | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb__editing1__2026-10-17T19-33-47-475Z.json, results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb__editing2__2026-10-17T20-35-20-692Z.json, results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb__editing3__2026-10-17T21-24-38-599Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb__editing1__2026-10-17T19-33-47-475Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb__editing2__2026-10-17T20-35-20-692Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb__editing3__2026-10-17T21-24-38-599Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 59,
        "p95": 90.40000000596046,
        "max": 90.40000000596046
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 58.8999999910593,
        "p95": 85.29999999701977,
        "max": 85.29999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 67.80000001192093,
        "p95": 99.6000000089407,
        "max": 99.6000000089407
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 36.1000000089407,
        "p95": 66.3999999910593,
        "max": 66.3999999910593
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSON Formatter Online, prettified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'CodeMirror', 'update': 'Format button rewrites the same editor', 'output': '.cm-content'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 14.1 ms | 17.4 ms | Not measured | 0 | 16.8 ms | Not measured |
| middle | 3 | 26.1 ms | 29.5 ms | Not measured | 0 | 83.4 ms | 74.0 ms |
| end | 3 | 26.5 ms | 31.0 ms | Not measured | 0 | 100.1 ms | 75.0 ms |

Raw sources: results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb-pretty__editing1__2026-10-17T19-46-23-443Z.json, results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb-pretty__editing2__2026-10-17T20-24-52-743Z.json, results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb-pretty__editing3__2026-10-17T21-35-31-724Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb-pretty__editing1__2026-10-17T19-46-23-443Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb-pretty__editing2__2026-10-17T20-24-52-743Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/json-formatter-online__1mb-pretty__editing3__2026-10-17T21-35-31-724Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 32.29999999701977,
        "p95": 43.29999999701977,
        "max": 43.29999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 31.400000005960464,
        "p95": 39.19999998807907,
        "max": 39.19999998807907
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 31.600000008940697,
        "p95": 51.70000000298023,
        "max": 51.70000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 26.799999997019768,
        "p95": 27.80000001192093,
        "max": 27.80000001192093
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSON Formatter Online, minified 10 MB, 2026-10-18; public site

Editor design: {'editor': 'CodeMirror', 'update': 'Format button rewrites the same editor', 'output': '.cm-content'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 80.5 ms | 90.7 ms | 764.1 ms | 3 | 150.0 ms | 106.0 ms |
| middle | 3 | 50.7 ms | 65.5 ms | Not measured | 0 | 100.0 ms | 87.0 ms |
| end | 3 | 32.8 ms | 40.4 ms | Not measured | 0 | 83.4 ms | 75.0 ms |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb__editing1__2026-10-18T06-42-53-728Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb__editing2__2026-10-18T07-07-14-010Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb__editing3__2026-10-18T07-35-03-241Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb__editing1__2026-10-18T06-42-53-728Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb__editing2__2026-10-18T07-07-14-010Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb__editing3__2026-10-18T07-35-03-241Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 47.20000000298023,
        "p95": 59.900000005960464,
        "max": 59.900000005960464
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 49.29999999701977,
        "p95": 60.5,
        "max": 60.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 69.1000000089407,
        "p95": 108.19999998807907,
        "max": 108.19999998807907
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 35.400000005960464,
        "p95": 43.5,
        "max": 43.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 9,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSON Formatter Online, prettified 10 MB, 2026-10-18; public site

Editor design: {'editor': 'CodeMirror', 'update': 'Format button rewrites the same editor', 'output': '.cm-content'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 10.7 ms | 12.1 ms | Not measured | 0 | 16.8 ms | Not measured |
| middle | 3 | 26.1 ms | 27.5 ms | Not measured | 0 | 100.0 ms | 74.0 ms |
| end | 2 | 26.1 ms | 27.8 ms | Not measured | 0 | 83.4 ms | 73.0 ms |

Raw sources: results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json, results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json

{
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "end: Find did not render the caret target",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 8,
        "median": 26.599999994039536,
        "p95": 45,
        "max": 45
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 8
    },
    "backspace": {
      "raf": {
        "n": 8,
        "median": 30.100000008940697,
        "p95": 44.19999998807907,
        "max": 44.19999998807907
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 8
    },
    "snippet": {
      "raf": {
        "n": 8,
        "median": 31.599999994039536,
        "p95": 42.70000000298023,
        "max": 42.70000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 8,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 8,
        "median": 26.399999991059303,
        "p95": 28.799999997019768,
        "max": 28.799999997019768
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 8,
      "confirmedEffects": 8,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": null
        }
      ]
    }
  }
}

## JSONLint, minified 100 KB, 2026-10-17; public site

Editor design: {'editor': 'Monaco', 'update': 'Validate and Prettify rewrite the same editor', 'output': '.monaco-editor .view-lines'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 120.6 ms | 187.1 ms | Not measured | 0 | 133.3 ms | 106.0 ms |
| middle | 3 | 133.7 ms | 198.8 ms | Not measured | 0 | 149.9 ms | 125.0 ms |
| end | 4 | 144.0 ms | 208.2 ms | Not measured | 0 | 133.4 ms | 118.0 ms |

Raw sources: results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing1__2026-10-17T19-03-54-543Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing1__2026-10-17T19-23-58-960Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing2__2026-10-17T20-17-32-250Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing3__2026-10-17T21-07-17-536Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing1__2026-10-17T19-03-54-543Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "start: Missing source/output edit marker, unexpected trusted-key count or missing frame",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing1__2026-10-17T19-23-58-960Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing2__2026-10-17T20-17-32-250Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "middle: Missing source/output edit marker, unexpected trusted-key count or missing frame",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb__editing3__2026-10-17T21-07-17-536Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 12,
        "median": 14.5,
        "p95": 50.79999999701977,
        "max": 50.79999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12
    },
    "backspace": {
      "raf": {
        "n": 12,
        "median": 23.599999994039536,
        "p95": 120.79999999701977,
        "max": 120.79999999701977
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12
    },
    "snippet": {
      "raf": {
        "n": 12,
        "median": 8,
        "p95": 137.8999999910593,
        "max": 137.8999999910593
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 12,
        "median": 30.19999999552965,
        "p95": 131.39999999850988,
        "max": 131.39999999850988
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12,
      "confirmedEffects": 11,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSONLint, prettified 100 KB, 2026-10-17; public site

Editor design: {'editor': 'Monaco', 'update': 'Validate and Prettify rewrite the same editor', 'output': '.monaco-editor .view-lines'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 16.9 ms | 21.6 ms | Not measured | 0 | 133.3 ms | 74.0 ms |
| middle | 2 | 13.5 ms | 18.7 ms | Not measured | 0 | 133.3 ms | 102.0 ms |
| end | 0 | Not measured | Not measured | Not measured | 0 | 166.6 ms | 113.0 ms |

Raw sources: results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-18-55-416Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-25-34-801Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing2__2026-10-17T20-07-32-664Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing3__2026-10-17T21-17-00-937Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-18-55-416Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "end: Missing source/output edit marker, unexpected trusted-key count or missing frame",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing1__2026-10-17T19-25-34-801Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "start: Missing source/output edit marker, unexpected trusted-key count or missing frame; middle: Missing source/output edit marker, unexpected trusted-key count or missing frame; end: Missing source/output edit marker, unexpected trusted-key count or missing frame",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing2__2026-10-17T20-07-32-664Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "middle: Missing source/output edit marker, unexpected trusted-key count or missing frame; end: Missing source/output edit marker, unexpected trusted-key count or missing frame",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__100kb-pretty__editing3__2026-10-17T21-17-00-937Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "end: Missing source/output edit marker, unexpected trusted-key count or missing frame",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 12,
        "median": 20.899999991059303,
        "p95": 78.5,
        "max": 78.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12
    },
    "backspace": {
      "raf": {
        "n": 12,
        "median": 70.69999998807907,
        "p95": 75.19999998807907,
        "max": 75.19999998807907
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12
    },
    "snippet": {
      "raf": {
        "n": 12,
        "median": 9.799999997019768,
        "p95": 15.300000011920929,
        "max": 15.300000011920929
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 12,
        "median": 76.79999999701977,
        "p95": 94.8999999910593,
        "max": 94.8999999910593
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 12,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": false
        }
      ]
    }
  }
}

## JSONLint, minified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'Monaco', 'update': 'Validate and Prettify rewrite the same editor', 'output': '.monaco-editor .view-lines'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 3 | 1980.1 ms | 2820.6 ms | Not measured | 0 | 1899.9 ms | 1362.0 ms |
| middle | 3 | 1923.3 ms | 2788.7 ms | Not measured | 0 | 2083.2 ms | 1483.0 ms |
| end | 3 | 2072.6 ms | 2950.7 ms | Not measured | 0 | 2049.9 ms | 1450.0 ms |

Raw sources: results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb__editing1__2026-10-17T19-36-58-349Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb__editing2__2026-10-17T20-31-15-444Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb__editing3__2026-10-17T21-25-58-285Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb__editing1__2026-10-17T19-36-58-349Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb__editing2__2026-10-17T20-31-15-444Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb__editing3__2026-10-17T21-25-58-285Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 9,
        "median": 276.09999999403954,
        "p95": 1460.5999999940395,
        "max": 1460.5999999940395
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "backspace": {
      "raf": {
        "n": 9,
        "median": 194.79999999701977,
        "p95": 1272.5,
        "max": 1272.5
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9
    },
    "snippet": {
      "raf": {
        "n": 9,
        "median": 23.099999994039536,
        "p95": 1308.4000000059605,
        "max": 1308.4000000059605
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 9,
        "median": 391.79999999701977,
        "p95": 1579,
        "max": 1579
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 9,
      "confirmedEffects": 5,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": false
        },
        {
          "position": "middle",
          "confirmed": false
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  }
}

## JSONLint, prettified 1 MB, 2026-10-17; public site

Editor design: {'editor': 'Monaco', 'update': 'Validate and Prettify rewrite the same editor', 'output': '.monaco-editor .view-lines'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing1__2026-10-17T19-47-26-943Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing2__2026-10-17T20-23-34-311Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing3__2026-10-17T21-36-34-046Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing1__2026-10-17T19-47-26-943Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing2__2026-10-17T20-23-34-311Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__1mb-pretty__editing3__2026-10-17T21-36-34-046Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}

## JSONLint, minified 10 MB, 2026-10-17; public site

Editor design: {'editor': 'Monaco', 'update': 'Validate and Prettify rewrite the same editor', 'output': '.monaco-editor .view-lines'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing1__2026-10-17T19-55-58-249Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing2__2026-10-17T20-53-45-737Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing3__2026-10-17T21-45-02-960Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing1__2026-10-17T19-55-58-249Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing2__2026-10-17T20-53-45-737Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb__editing3__2026-10-17T21-45-02-960Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "start-dispatched",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": null
        }
      ]
    }
  }
}

## JSONLint, prettified 10 MB, 2026-10-17; public site

Editor design: {'editor': 'Monaco', 'update': 'Validate and Prettify rewrite the same editor', 'output': '.monaco-editor .view-lines'}

| Position | Verified profiles | rAF median | rAF p95 | Visible-output median | Confirmed output intervals | Longest frame | Longest task |
|---|---|---|---|---|---|---|---|
| start | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| middle | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |
| end | 0 | Not measured | Not measured | Not measured | 0 | Not measured | Not measured |

Raw sources: results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing1__2026-10-17T20-06-06-654Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing2__2026-10-17T20-42-34-338Z.json, results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing3__2026-10-17T22-03-49-607Z.json

{
  "outcomes": [
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing1__2026-10-17T20-06-06-654Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing2__2026-10-17T20-42-34-338Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/2026-10-17-competitors-6g/results/raw/jsonlint__10mb-pretty__editing3__2026-10-17T22-03-49-607Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "unresponsive during editing",
      "rawEditingStatus": "unresponsive during editing",
      "reason": "Runtime.evaluate: timeout 5000ms",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "backspace": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0
    },
    "snippet": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "methods": []
    },
    "undo": {
      "raf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 0,
      "confirmedEffects": 0,
      "effectNotes": []
    }
  }
}


## October 18 JFO prettified 10 MB correction

The one documented JSON Formatter Online prettified 10 MB repeat leaves 3/4 complete profiles. The original failed profile remains visible. Combined typing quantiles use only complete profiles at all three caret positions, with the same nearest-rank and Event Timing censoring rules. The corrected aggregate has rAF median/p95 25.3 ms / 28.2 ms, and Event Timing 32.0 ms / 32.0 ms. Prettified source and formatted output share one CodeMirror editor, so separate formatter completion remains unmeasured. At prettified 10 MB, Tool Kumar has the lower keydown-to-frame median. Tool Kumar records 14.5 ms / 18.4 ms median/p95 beside JSON Formatter Online 25.3 ms / 28.2 ms. Keep the Event Timing and tail results separate.

{
  "site": "JSON Formatter Online",
  "size": "10mb-pretty",
  "format": "prettified",
  "sourceSize": "10mb",
  "runs": 4,
  "completeProfiles": 3,
  "matchedSources": [
    "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
    "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
    "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json"
  ],
  "opening": {
    "n": 4,
    "median": 1041,
    "p95": 1334,
    "max": 1334
  },
  "design": {
    "editor": "CodeMirror",
    "update": "Format button rewrites the same editor",
    "output": ".cm-content"
  },
  "fixture": {
    "size": "10mb",
    "key": "10mb-pretty",
    "format": "prettified",
    "minifiedSourceSha256": "1fc37b1b236e28c4c3aa850ffd9100f2fc08f58f9c7a7d1e7006d034ee73a76d",
    "file": "bench-10mb-pretty.json",
    "bytes": 18592911,
    "characters": 18495818,
    "lines": 788600,
    "sha256": "7c58a423f0f7bbd22159b6519acd16faea3377fe6501a796b70c652deed1e6d9",
    "positions": [
      {
        "name": "start",
        "email": "user1@example.com",
        "offset": 485,
        "line": 20,
        "column": 33
      },
      {
        "name": "middle",
        "email": "user6013@example.com",
        "offset": 9290103,
        "line": 396294,
        "column": 36
      },
      {
        "name": "end",
        "email": "user12025@example.com",
        "offset": 18494201,
        "line": 788529,
        "column": 37
      }
    ]
  },
  "editAnyway": false,
  "outcomes": [
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "partly measured",
      "rawEditingStatus": "partly measured",
      "reason": "end: Find did not render the caret target",
      "phase": "source restoration",
      "memoryStop": null
    },
    {
      "source": "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json",
      "opening": "ok",
      "rawOpeningStatus": "ok",
      "editing": "measured",
      "rawEditingStatus": "measured",
      "phase": "source restoration",
      "memoryStop": null
    }
  ],
  "raf": {
    "n": 180,
    "median": 25.30000001192093,
    "p95": 28.200000002980232,
    "max": 42.6000000089407
  },
  "eventTiming": {
    "median": "32.0 ms",
    "p95": "32.0 ms",
    "entries": 175,
    "totalKeys": 180,
    "censoredBelow16ms": 5,
    "conditional": {
      "n": 175,
      "median": 32,
      "p95": 32,
      "max": 64
    }
  },
  "positions": [
    {
      "position": "start",
      "runs": 4,
      "verifiedRuns": 4,
      "outcomes": [
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        }
      ],
      "raf": {
        "n": 80,
        "median": 11,
        "p95": 17.30000001192093,
        "max": 17.400000005960464
      },
      "eventTimingAboveThreshold": {
        "n": 75,
        "median": 16,
        "p95": 24,
        "max": 32
      },
      "eventTimingMissingOrBelow16ms": 5,
      "outputUpdate": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "buttonToOutput": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "outputConfirmedRuns": 0,
      "outputEvidence": [
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": true,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": true,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": true,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        },
        {
          "source": "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": true,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        }
      ],
      "outputMeasurementNote": "The prettified source is already the formatted view in this same editor. A separate formatted-output update after its button cannot be isolated; raw observer intervals are retained but excluded from this summary.",
      "outputVisibilityNote": null,
      "longestFrameMs": 16.80000000000291,
      "longestTaskMs": null
    },
    {
      "position": "middle",
      "runs": 4,
      "verifiedRuns": 4,
      "outcomes": [
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        }
      ],
      "raf": {
        "n": 80,
        "median": 26.100000008940697,
        "p95": 30.400000005960464,
        "max": 43.5
      },
      "eventTimingAboveThreshold": {
        "n": 80,
        "median": 32,
        "p95": 32,
        "max": 64
      },
      "eventTimingMissingOrBelow16ms": 0,
      "outputUpdate": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "buttonToOutput": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "outputConfirmedRuns": 0,
      "outputEvidence": [
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": false,
          "markerInDOMButNotVisible": true,
          "afterTimeout": null
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": false,
          "markerInDOMButNotVisible": true,
          "afterTimeout": null
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": false,
          "markerInDOMButNotVisible": true,
          "afterTimeout": null
        },
        {
          "source": "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": false,
          "markerInDOMButNotVisible": true,
          "afterTimeout": null
        }
      ],
      "outputMeasurementNote": "The prettified source is already the formatted view in this same editor. A separate formatted-output update after its button cannot be isolated; raw observer intervals are retained but excluded from this summary.",
      "outputVisibilityNote": null,
      "longestFrameMs": 100,
      "longestTaskMs": 74
    },
    {
      "position": "end",
      "runs": 4,
      "verifiedRuns": 3,
      "outcomes": [
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
          "status": "could not be measured",
          "reason": "Find did not render the caret target",
          "sourceMarkerObserved": null,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        },
        {
          "source": "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json",
          "status": "measured",
          "nativeInputEvents": 0,
          "sourceMarkerObserved": true,
          "publicCopyMarkerObserved": null,
          "verificationNote": "Latency requires a source or visible-output marker, 20 trusted keydown events and observed frames. Native input events are editor-dependent and are not a separate pass requirement.",
          "protocolTimeouts": 0
        }
      ],
      "raf": {
        "n": 60,
        "median": 26.100000008940697,
        "p95": 32.20000000298023,
        "max": 38.5
      },
      "eventTimingAboveThreshold": {
        "n": 60,
        "median": 32,
        "p95": 40,
        "max": 64
      },
      "eventTimingMissingOrBelow16ms": 0,
      "outputUpdate": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "buttonToOutput": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "outputConfirmedRuns": 0,
      "outputEvidence": [
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": true,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": true,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        },
        {
          "source": "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": false,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        },
        {
          "source": "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json",
          "prepositioningNote": null,
          "outputNote": null,
          "visibleMarkerConfirmed": true,
          "markerInDOMButNotVisible": false,
          "afterTimeout": null
        }
      ],
      "outputMeasurementNote": "The prettified source is already the formatted view in this same editor. A separate formatted-output update after its button cannot be isolated; raw observer intervals are retained but excluded from this summary.",
      "outputVisibilityNote": null,
      "longestFrameMs": 83.39999999999418,
      "longestTaskMs": 74
    }
  ],
  "operations": {
    "enter": {
      "raf": {
        "n": 11,
        "median": 27.799999997019768,
        "p95": 45,
        "max": 45
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11
    },
    "backspace": {
      "raf": {
        "n": 11,
        "median": 30.100000008940697,
        "p95": 44.19999998807907,
        "max": 44.19999998807907
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11
    },
    "snippet": {
      "raf": {
        "n": 11,
        "median": 32.099999994039536,
        "p95": 42.70000000298023,
        "max": 42.70000000298023
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11,
      "methods": [
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard",
        "Trusted Ctrl+V from browser clipboard"
      ]
    },
    "undo": {
      "raf": {
        "n": 11,
        "median": 26.80000001192093,
        "p95": 28.799999997019768,
        "max": 28.799999997019768
      },
      "inputEventRaf": {
        "n": 0,
        "median": null,
        "p95": null,
        "max": null
      },
      "clock": "Trusted keydown to next rAF. If no keydown exists for an Input.insertText fallback, the input-event-to-frame bound is used and the method is recorded. This is not confirmation that the operation completed.",
      "samples": 11,
      "confirmedEffects": 11,
      "effectNotes": [
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": null
        },
        {
          "position": "start",
          "confirmed": true
        },
        {
          "position": "middle",
          "confirmed": true
        },
        {
          "position": "end",
          "confirmed": true
        }
      ]
    }
  },
  "scrolling": {
    "outcomes": [
      "Page scroll fallback; no native input range",
      "Page scroll fallback; no native input range",
      "Page scroll fallback; no native input range",
      "Page scroll fallback; no native input range"
    ],
    "frames": {
      "n": 0,
      "median": null,
      "p95": null,
      "max": null
    },
    "pageFallbackProfiles": 4
  },
  "rendererPeakMiB": {
    "n": 4,
    "median": 1217,
    "p95": 1381,
    "max": 1381
  },
  "sources": [
    "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing1__2026-10-18T06-46-27-082Z.json",
    "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing2__2026-10-18T07-10-48-044Z.json",
    "results/refresh-2026-10-18T06-23-00-569Z/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T07-38-44-132Z.json",
    "results/validation-2026-10-18-followup/results/raw/json-formatter-online__10mb-pretty__editing3__2026-10-18T12-19-22-447Z.json"
  ]
}
