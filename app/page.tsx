import JsonTool from '@/components/JsonTool';

const SITE = 'https://tools.vikasmaur.com';

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'JSON Viewer & Formatter',
  url: SITE,
  description:
    'Format, validate, repair and explore JSON in your browser. Tree and table views, precise error messages, search, JSONPath, CSV export and offline support.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  featureList: [
    'JSON formatter and beautifier',
    'JSON validator with exact line and column errors',
    'One-click JSON repair',
    'Collapsible tree view',
    'Table view with CSV export',
    'Search keys and values, JSONPath navigation',
    'Minify and sort keys',
    'Lossless big numbers',
    'Works offline, 100% client-side',
  ],
};

// Restores the last document into the textarea before React hydrates, so
// returning visitors see their JSON immediately (big ones are restored by the
// engine straight into the fast read-only view instead).
const RESTORE = `try{var t=document.getElementById('input'),v=localStorage.getItem('jf:doc');if(t&&v&&!t.value&&v.length<2e5)t.value=v}catch(e){}`;

export default function Page() {
  return (
    <>
      <JsonTool />
      <script dangerouslySetInnerHTML={{ __html: RESTORE }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }} />
    </>
  );
}
