// static.app/json-beautifier.
export default {
  id: 'static-app',
  name: 'Static.app JSON Beautifier',
  url: 'https://static.app/json-beautifier',
  consent: 'button:has-text("Only necessary")',
  input: { kind: 'textarea', sel: 'textarea' },
  output: { kind: 'textarea', sel: 'textarea:nth-of-type(1)' },
  format: 'button:has-text("Beautify")',
  error: [],
  features: {},
};
