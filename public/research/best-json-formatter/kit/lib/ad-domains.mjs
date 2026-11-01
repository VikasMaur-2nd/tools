// Ad-serving and ad-auction domains (protocol 5.5). A request to one of these, or a subdomain, counts as an ad
// request. Analytics-only domains (Google Analytics, PostHog, Vercel) are not here: they count as third parties.
export const AD_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'adtrafficquality.google',
  'amazon-adsystem.com', 'adnxs.com', 'criteo.com', 'criteo.net', 'pubmatic.com', 'rubiconproject.com', 'openx.net',
  'taboola.com', 'outbrain.com', 'media.net', 'carbonads.net', 'carbonads.com', 'buysellads.com', 'buysellads.net',
  'ezoic.net', 'ezojs.com', 'ezodn.com', 'adthrive.com', 'mediavine.com', '33across.com', 'sharethrough.com', 'yieldmo.com',
  'indexww.com', 'casalemedia.com', 'smartadserver.com', 'adsrvr.org', 'moatads.com', 'adsafeprotected.com',
  'doubleverify.com', 'teads.tv', 'sovrn.com', 'lijit.com', 'gumgum.com', 'triplelift.com', '3lift.com', 'adform.net',
  'contextweb.com', 'districtm.io', 'improvedigital.com', 'seedtag.com', 'kargo.com', 'onetag-sys.com', 'richaudience.com',
  'yieldlove.com', 'adpushup.com', 'snigelweb.com', 'freestar.com', 'pub.network', 'publift.com', 'nitropay.com',
  'venatus.com', 'playwire.com', 'monetixads.com', 'propellerads.com', 'popads.net', 'adsterra.com', 'adcash.com',
  'hilltopads.net', 'infolinks.com', 'vidoomy.com', 'primis.tech', 'connatix.com', 'aniview.com', 'ad-delivery.net',
  'adsco.re', 'ethicalads.io', 'fundingchoicesmessages.google.com', 'quantcast.com', 'quantserve.com', 'bidswitch.net',
  'smaato.net', 'ads.yahoo.com', 'advertising.com', 'gammaplatform.com', 'pubgalaxy.com', 'adligature.com',
  'a-mo.net', 'intergient.com', 'fsrv.io', 'prebid.org', 'id5-sync.com', 'rlcdn.com', 'bidr.io', 'servenobid.com', 'nextmillmedia.com',
];
