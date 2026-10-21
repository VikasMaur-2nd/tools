import CopyButton from '@/components/CopyButton';
import { Code } from '../blogs/article';

/** A highlighted code block with a Copy button, for code readers paste into their own projects. */
export default function CodeSnippet({ code, lang, name }: { code: string; lang: string; name: string }) {
  return (
    <div className="ig-snippet">
      <CopyButton text={code} label="Copy" name={`Copy ${name}`} className="ig-copy" />
      <Code lang={lang}>{code}</Code>
    </div>
  );
}
