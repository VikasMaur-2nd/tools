// static.app/json-beautifier.
export default {
  id: 'static-app',
  name: 'Static.app JSON Beautifier',
  url: 'https://static.app/json-beautifier',
  input: { kind: 'textarea', sel: 'textarea' },
  output: { kind: 'textarea', sel: 'textarea >> nth=1' },
  format: 'button:has-text("Beautify")',
  error: [],
  features: {},
};
