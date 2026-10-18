import GeneratorPanel from '@/components/testdata/GeneratorPanel';
import { TESTDATA_PAGES } from '@/lib/testdata/pages';
import { TestdataPage, testdataMetadata } from '../testdata-page';

const page = TESTDATA_PAGES[0];
export const metadata = testdataMetadata(page);
export default function Page() {
  return <TestdataPage page={page}><GeneratorPanel /></TestdataPage>;
}
