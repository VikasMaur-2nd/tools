/**
 * /.well-known/mcp.json: the WebMCP tools (./tools.ts) listed for crawlers and directories that
 * read a site's tools without running its pages (webmcpdirectory.com does; the names can't be read
 * from our scripts, since the tools load only in browsers with WebMCP). The tools run in the page,
 * not on a server, so no entry has an endpoint. Built from TOOLS, so it can't drift from them.
 */
import { TOOLS } from './tools';

export function descriptor(site: string) {
  return {
    name: 'Tool Kumar',
    description:
      'Free, private JSON tools that run in the browser. The JSON viewer and every JSON tool page register these tools ' +
      'for AI agents through WebMCP (document.modelContext). They work on the document open in the page and run on ' +
      "the user's device; there is no server endpoint.",
    homepage: site,
    documentation: `${site}/llms.txt`,
    provider: { name: 'Tool Kumar', url: site },
    webmcp: { pages: [`${site}/`, `${site}/tools/{tool}`] },
    tools: TOOLS.map(({ name, title, description }) => ({ name, title, description })),
  };
}
