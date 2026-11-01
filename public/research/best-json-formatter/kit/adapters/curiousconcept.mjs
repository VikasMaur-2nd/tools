// jsonformatter.curiousconcept.com: a text box and a Process button that sends the JSON to its server
// (POST /process). That endpoint answered HTTP 403 to the automated browser everywhere we tried, so the tool is
// not ranked (protocol, amendment 1 item 9); one run records what the page sends and loads, and its features.
import { selectHas } from './_checks.mjs';
export default {
  id: 'curiousconcept',
  name: 'JSON Formatter & Validator (Curious Concept)',
  url: 'https://jsonformatter.curiousconcept.com/',
  blocked: 'its formatting endpoint answered HTTP 403 to our automated browser, so formatting could not be tested',
  input: { kind: 'textarea', sel: 'textarea#data' },
  output: { kind: 'text', sel: '#formatted, .formatted, pre' },
  format: 'button:has-text("Process")',
  error: [],
  features: {
    indent: 'select#jsontemplate',
    minify: selectHas('select#jsontemplate', /compact/),
    tree: 'button:has-text("Tree"), a:has-text("Tree")',
    search: '[placeholder*="search" i]:visible',
    sortKeys: 'button:has-text("Sort")',
    copy: 'button:has-text("Copy"), [title*="copy" i]',
    download: 'button:has-text("Download"), [title*="download" i]',
    openFile: 'button:has-text("Load File")',
    loadUrl: 'label:has-text("JSON Data/URL")',
    darkMode: '[title*="dark" i], [aria-label*="theme" i]',
    repair: 'input#jsonfix',
    convert: 'button:has-text("Convert")',
  },
};
