import CodeLangBar from '@/components/CodeLang';
import { Code } from '../blogs/article';

/** A published function in JavaScript and TypeScript (components/CodeLang.tsx picks which shows), with a Copy button. */
export default function CodeSnippet({ name, js, ts }: { name: string; js: string; ts: string }) {
  return (
    <div className="ig-snippet">
      <CodeLangBar name={name} js={js} ts={ts} />
      <div className="snip-js">
        <Code lang="javascript" links>{js}</Code>
      </div>
      <div className="snip-ts">
        <Code lang="typescript" links>{ts}</Code>
      </div>
    </div>
  );
}
