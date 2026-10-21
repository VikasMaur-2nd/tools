/*! "View in Tool Kumar" links, v1 · https://tools.vikasmaur.com/resources/view-in-tool-kumar · MIT License
 *
 * Opens JSON documents, or two of them compared, in Tool Kumar (https://tools.vikasmaur.com).
 * Documents never touch a server: links carry them compressed in the URL fragment, and
 * open() hands big ones to the new tab with postMessage. No dependencies.
 *
 *   const href = await ToolKumar.link({ json: data, view: 'tree' });
 *   const diff = await ToolKumar.link({ json: before, compare: after });
 *   button.onclick = () => ToolKumar.open({ json: hugeResponseText });
 *
 * Options (one of json/url, then optionally one of compare/compareUrl):
 *   json        the document: a JSON string (kept as written) or any value (JSON.stringify'd)
 *   url         instead of json: an http(s) URL Tool Kumar fetches (the server must allow CORS)
 *   compare     a second document to compare with the first; Compare opens by itself
 *   compareUrl  instead of compare: a URL to fetch the second document from
 *   view        format | tree | table | graph | convert | compare
 *   to          with view 'convert': typescript, zod, json-schema, go, python, csv, yaml, …
 *
 * Works in browsers and in Node 18+ (link only): `const ToolKumar = require('./toolkumar.js')`.
 */
(function (root) {
  'use strict';

  var VIEWS = ['format', 'tree', 'table', 'graph', 'convert', 'compare'];
  /** Longer links get cut by chat apps and some browsers: open() hands those documents over instead. */
  var MAX_LINK = 60000;

  function text(value, name) {
    var s = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof s !== 'string') throw new TypeError('ToolKumar: `' + name + '` is not JSON');
    return s;
  }

  function checkUrl(url, name) {
    if (!/^https?:\/\//i.test(url)) throw new TypeError('ToolKumar: `' + name + '` must be an http(s) URL');
    return encodeURIComponent(url);
  }

  /** Raw DEFLATE (CompressionStream 'deflate-raw'), base64url without padding. */
  async function encode(s) {
    var stream = new Blob([s]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    var buf = new Uint8Array(await new Response(stream).arrayBuffer());
    var bin = '';
    for (var i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function check(o) {
    if (!o || (o.json === undefined && !o.url)) throw new TypeError('ToolKumar: pass `json` or `url`');
    if (o.view !== undefined && VIEWS.indexOf(o.view) < 0) throw new TypeError('ToolKumar: `view` must be one of ' + VIEWS.join(', '));
  }

  /** A link that opens the documents: put it in an <a href>, a README or an email. */
  async function link(o) {
    check(o);
    var parts = [];
    parts.push('a=' + (o.url ? checkUrl(o.url, 'url') : await encode(text(o.json, 'json'))));
    var b = o.compareUrl ? checkUrl(o.compareUrl, 'compareUrl') : o.compare !== undefined ? await encode(text(o.compare, 'compare')) : null;
    if (b) parts.push('b=' + b);
    if (o.view && !(o.view === 'compare' && b)) parts.push('view=' + o.view);
    if (o.view === 'convert' && o.to) parts.push('to=' + encodeURIComponent(o.to));
    return api.origin + '/#' + parts.join('&');
  }

  /**
   * Opens the documents in a new tab. Call it straight from a click (browsers block pop-ups
   * opened later). Resolves with the tab once Tool Kumar has the documents.
   */
  function open(o) {
    check(o);
    var origin = api.origin;
    // Documents named by URL make a short link; everything else is handed over, whatever its size.
    var viaLink = !!(o.url || o.compareUrl);
    var tab = window.open(viaLink ? '' : origin + '/#handoff', '_blank');
    if (!tab) return Promise.reject(new Error('ToolKumar: the browser blocked the new tab'));
    if (viaLink) {
      tab.opener = null;
      return link(o).then(function (href) {
        if (href.length > MAX_LINK) throw new Error('ToolKumar: too large for a link; pass the document as `json`');
        tab.location.href = href;
        return tab;
      }, function (e) {
        tab.close();
        throw e;
      });
    }
    var message = {
      toolkumar: 'open',
      a: text(o.json, 'json'),
      b: o.compare === undefined ? undefined : text(o.compare, 'compare'),
      view: o.view,
      to: o.to,
    };
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        done(new Error('ToolKumar: the tab did not answer'));
      }, 60000);
      function done(error) {
        clearTimeout(timer);
        removeEventListener('message', onMessage);
        if (error) reject(error);
        else resolve(tab);
      }
      function onMessage(e) {
        if (e.source !== tab || e.origin !== origin || !e.data) return;
        var kind = e.data.toolkumar;
        if (kind === 'ready') tab.postMessage(message, origin);
        else if (kind === 'opened') done();
        else if (kind === 'error') done(new Error('ToolKumar: the tab could not open it (' + e.data.reason + ')'));
      }
      addEventListener('message', onMessage);
    });
  }

  var api = { version: 1, origin: 'https://tools.vikasmaur.com', link: link, open: open };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ToolKumar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
