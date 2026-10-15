import JsonTool from '@/components/JsonTool';
import IntentLink from '@/components/IntentLink';
import ToolPageRoute from './tool-page';

export { generateMetadata, generateStaticParams } from './tool-page';
export const ensureStatic = 'navigation';

export default function Page(props: PageProps<'/tools/[slug]'>) {
  return ToolPageRoute(props, (toolProps) => <JsonTool {...toolProps} />, IntentLink);
}
