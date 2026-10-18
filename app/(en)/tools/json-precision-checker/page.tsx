import PrecisionPanel from '@/components/testdata/PrecisionPanel';
import { TESTDATA_PAGES } from '@/lib/testdata/pages';
import { TestdataPage, testdataMetadata } from '../testdata-page';

const page = TESTDATA_PAGES[1];
export const metadata = testdataMetadata(page);
export default function Page() {
  return <TestdataPage page={page}><PrecisionPanel /></TestdataPage>;
}
