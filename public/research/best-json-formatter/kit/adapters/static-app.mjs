// static.app/json-beautifier: an input text box and an output text box ("Beautified JSON result"), a Beautify
// button, and a cookie banner (answered "Only necessary"). It blocks some networks with a Cloudflare check; the
// GitHub runners got through. Adapter written from dev/probe.mjs on a runner (run 41333830896).
import { repairOffered } from './_checks.mjs';

export default {
  id: 'static-app',
  name: 'Static.app JSON Beautifier',
  url: 'https://static.app/json-beautifier',
  consent: 'button:has-text("Only necessary")',
  input: { kind: 'textarea', sel: 'textarea#jsonBeautifier' },
  output: { kind: 'textarea', sel: 'textarea#json-copy' },
  format: 'button[title="Beautify the JSON input"], button:has-text("Beautify")',
  error: ['#jb-live.jb-live--err'],
  features: {
    indent: 'button:has-text("4 spaces")',
    minify: 'button:has-text("Minify")',
    tree: 'button:text-is("Tree")',
    search: '[placeholder*="search" i]:visible, button[aria-label*="search" i]',
    sortKeys: 'button:has-text("Sort keys")',
    copy: 'button[title^="Copy beautified"], button:has-text("Copy")',
    download: 'button[title^="Download beautified"], button:has-text("Download")',
    openFile: 'button:has-text("Open JSON file")',
    loadUrl: 'button:has-text("Load URL"), button:has-text("From URL")',
    darkMode: '[aria-label*="theme" i], [title*="theme" i], [title*="dark" i]',
    repair: repairOffered('button:has-text("Repair"), button:has-text("Fix")'),
    convert: 'button:has-text("Convert"), button:has-text("to YAML"), button:has-text("to CSV")',
  },
};
