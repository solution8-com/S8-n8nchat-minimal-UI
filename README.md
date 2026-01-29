# S8-n8nchat-minimal-UI 🚀

Minimal, internal template UI for solution8 — a tiny starter for n8n chat integrations. Use this repo as the official initial project to derive other UI projects from.

- Purpose: Minimal HTML/CSS UI shell.
- Status: Template / internal canonical starter.

Quick start
1. git clone https://github.com/solution8-com/S8-n8nchat-minimal-UI
2. Open index.html (or chat.html) in a browser — it’s purely static.

Important: where to edit the JavaScript
- The chat behavior (JS) lives in the companion JavaScript repository — edit the chat.html file there.
- Search for the exact text "create chat" inside that chat.html; that is the single line you need to change to customize behavior.
- Companion repo: [https://github.com/solution8-com/s8-n8nchat-js](https://github.com/solution8-com/S8-Utilities)
  - In that repo, open chat.html and update the "create chat" line as needed.

Why this repo exists
- Designed to be tiny and opinionated so teams can fork/derive quickly.
- Keeps UI concerns separate from JS logic (which is maintained in the other repo).

License
MIT License

Copyright (c) 2026 solution8

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

Small note ✨
- Keep this repo minimal — change the JS in the companion repo only.
- This is one of solution8’s official initial canonical projects — treat it as the template root for new UI work.
